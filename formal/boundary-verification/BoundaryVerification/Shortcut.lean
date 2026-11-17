import Std

namespace BoundaryVerification.Shortcut

structure Token where
  registered : Bool
  ownerExists : Bool
  owner : Nat
  revoked : Bool
  expires : Option Nat
  project : Option Nat
  deriving DecidableEq, Repr

structure Project where
  id : Nat
  owner : Nat
  deriving DecidableEq, Repr

def beforeExpiry (now : Nat) (expires : Option Nat) : Bool :=
  match expires with
  | none => true
  | some deadline => now < deadline

def authenticate (now : Nat) (t : Token) : Bool :=
  t.registered && t.ownerExists && !t.revoked && beforeExpiry now t.expires

def boundAllowed (t : Token) (requested : Option Nat) : Bool :=
  match t.project, requested with
  | some bound, some target => bound == target
  | _, _ => true

def destinations (t : Token) (projects : List Project) (requested : Option Nat) :
    Option (List Project) :=
  if !boundAllowed t requested then none else
  let target := match requested with | some id => some id | none => t.project
  let owned := projects.filter (fun p => p.owner == t.owner)
  let selected := match target with
    | some id => owned.filter (fun p => p.id == id)
    | none => owned
  if selected.isEmpty then none else some selected

structure Link where
  owner : Nat
  project : Nat
  payload : Nat
  deriving DecidableEq, Repr

structure Receipt where
  owner : Nat
  key : Nat
  fingerprint : Nat
  liveStock : Bool
  deriving DecidableEq, Repr

-- payload/fingerprint abstract canonical input and the implementation request hash.
structure Business where
  links : List Link
  articles : List (Nat × Nat)
  receipts : List Receipt
  deriving DecidableEq, Repr

structure State where
  business : Business
  usage : Nat
  deriving DecidableEq, Repr

inductive Outcome where
  | rejected | conflict | replay | saved
  deriving DecidableEq, Repr

structure Result where
  outcome : Outcome
  state : State
  deriving DecidableEq, Repr

def remember (owner fingerprint : Nat) (key : Option Nat) (receipts : List Receipt) :
    List Receipt :=
  match key with
  | none => receipts
  | some k => ⟨owner, k, fingerprint, true⟩ :: receipts

def commit (owner payload fingerprint : Nat) (key : Option Nat)
    (targets : List Project) (s : State) : State :=
  let links := targets.map (fun p => Link.mk owner p.id payload)
  { s with business :=
    { links := s.business.links ++ links.filter (fun l => !s.business.links.contains l)
      articles := if s.business.articles.contains (owner, payload) then s.business.articles
        else (owner, payload) :: s.business.articles
      receipts := remember owner fingerprint key s.business.receipts } }

def step (now : Nat) (t : Token) (projects : List Project) (requested : Option Nat)
    (payload fingerprint : Nat) (key : Option Nat) (s : State) : Result :=
  if !authenticate now t then ⟨.rejected, s⟩ else
  let used := { s with usage := s.usage + 1 }
  match destinations t projects requested with
  | none => ⟨.rejected, used⟩
  | some targets =>
    let previous := match key with
      | none => none
      | some k => s.business.receipts.find? (fun (r : Receipt) => r.owner == t.owner && r.key == k)
    match previous with
    | some r => if r.fingerprint == fingerprint && r.liveStock then ⟨.replay, used⟩
        else ⟨.conflict, used⟩
    | none => ⟨.saved, commit t.owner payload fingerprint key targets used⟩

theorem expiry_equality_rejected (now : Nat) (t : Token) (h : t.expires = some now) :
    authenticate now t = false := by
  simp [authenticate, beforeExpiry, h]

theorem revoked_rejected (now : Nat) (t : Token) (h : t.revoked = true) :
    authenticate now t = false := by
  simp [authenticate, h]

theorem auth_denial_preserves_all (now : Nat) (t : Token) (ps : List Project)
    (requested : Option Nat) (payload fingerprint : Nat) (key : Option Nat) (s : State)
    (h : authenticate now t = false) :
    step now t ps requested payload fingerprint key s = ⟨.rejected, s⟩ := by
  simp [step, h]

theorem target_denial_preserves_business (now : Nat) (t : Token) (ps : List Project)
    (requested : Option Nat) (payload fingerprint : Nat) (key : Option Nat) (s : State)
    (h : destinations t ps requested = none) :
    (step now t ps requested payload fingerprint key s).state.business = s.business := by
  unfold step
  split <;> simp_all

theorem different_bound_rejected (t : Token) (ps : List Project) (bound target : Nat)
    (hb : t.project = some bound) (hne : bound ≠ target) :
    destinations t ps (some target) = none := by
  simp [destinations, boundAllowed, hb, hne]

theorem foreign_owner_rejected (owner other project : Nat) (hne : other ≠ owner) :
    destinations ⟨true, true, owner, false, none, none⟩ [⟨project, other⟩]
      (some project) = none := by
  simp [destinations, boundAllowed, hne]

theorem unrestricted_omission_selects_all_owned (t : Token) (ps : List Project)
    (h : t.project = none) :
    destinations t ps none =
      (let owned := ps.filter (fun p => p.owner == t.owner)
       if owned.isEmpty then none else some owned) := by
  simp [destinations, boundAllowed, h]

theorem unrestricted_destination_owned (t : Token) (ps selected : List Project) (p : Project)
    (ht : t.project = none) (hd : destinations t ps none = some selected)
    (hp : p ∈ selected) : p.owner = t.owner := by
  rw [unrestricted_omission_selects_all_owned t ps ht] at hd
  dsimp at hd
  split at hd
  · contradiction
  · have hs : ps.filter (fun q => q.owner == t.owner) = selected := Option.some.inj hd
    rw [← hs] at hp
    simpa using (List.mem_filter.mp hp).2

def token : Token := ⟨true, true, 1, false, none, none⟩
def projects : List Project := [⟨10, 1⟩, ⟨20, 1⟩, ⟨30, 2⟩]
def emptyState : State := ⟨⟨[], [], []⟩, 0⟩

theorem all_project_success_example :
    (step 50 token projects none 7 77 none emptyState).state.business.links =
      [⟨1, 10, 7⟩, ⟨1, 20, 7⟩] := by decide

theorem bound_omission_success_example :
    (step 50 { token with project := some 20 } projects none 7 77 none emptyState).outcome =
      .saved ∧
    (step 50 { token with project := some 20 } projects none 7 77 none emptyState).state.business.links =
      [⟨1, 20, 7⟩] := by decide

theorem revoked_denial_example :
    step 50 { token with revoked := true } projects none 7 77 none emptyState =
      ⟨.rejected, emptyState⟩ := by decide

def saved : State := (step 50 token projects none 7 77 (some 9) emptyState).state

theorem replay_preserves_business_example :
    (step 50 token projects none 7 77 (some 9) saved).outcome = .replay ∧
    (step 50 token projects none 7 77 (some 9) saved).state.business = saved.business := by decide

theorem changed_payload_conflicts_example :
    (step 50 token projects none 8 88 (some 9) saved).outcome = .conflict ∧
    (step 50 token projects none 8 88 (some 9) saved).state.business = saved.business := by decide

theorem deleted_receipt_conflicts_example :
    (step 50 token projects none 7 77 (some 9)
      ⟨⟨[], [], [⟨1, 9, 77, false⟩]⟩, 0⟩).outcome = .conflict := by decide

theorem replay_does_not_add_new_project_example :
    (step 50 token (projects ++ [⟨40, 1⟩]) none 7 77 (some 9) saved).state.business =
      saved.business := by decide

theorem absent_key_can_add_new_project_example :
    (step 50 token (projects ++ [⟨40, 1⟩]) none 7 77 none saved).state.business.links =
      [⟨1, 10, 7⟩, ⟨1, 20, 7⟩, ⟨1, 40, 7⟩] := by decide

end BoundaryVerification.Shortcut
