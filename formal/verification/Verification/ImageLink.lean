namespace Verification.ImageLink

structure Link where
  present : Bool
  tokenValid : Bool
  ready : Bool
  expires : Nat
  owner : Nat
  project : Nat
  pufu : Nat
  phase : Nat
  revision : Nat
  question : Option Nat
  deriving DecidableEq, Repr

structure Current where
  present : Bool
  pufu : Nat
  pufuOwner : Nat
  projectOwner : Nat
  project : Nat
  ready : Bool
  phase : Nat
  revision : Nat
  questionRelated : Bool
  deriving DecidableEq, Repr

structure Snapshot where
  link : Link
  current : Current
  /-- Public visibility is deliberately unrelated to this bearer capability. -/
  projectPublic : Bool
  businessData : Nat
  history : Nat
  usage : Nat
  deriving DecidableEq, Repr

def currentMatches (l : Link) (c : Current) : Prop :=
  c.present = true ∧ c.pufu = l.pufu ∧ c.pufuOwner = l.owner ∧
    c.projectOwner = l.owner ∧ c.project = l.project ∧ c.ready = true ∧
    c.phase = l.phase ∧ c.revision = l.revision ∧
    (l.question = none ∨ c.questionRelated = true)

instance (l : Link) (c : Current) : Decidable (currentMatches l c) := by
  unfold currentMatches
  infer_instance

def readable (s : Snapshot) (now : Nat) : Prop :=
  s.link.present = true ∧ s.link.tokenValid = true ∧ s.link.ready = true ∧
    now < s.link.expires ∧ currentMatches s.link s.current

instance (s : Snapshot) (now : Nat) : Decidable (readable s now) := by
  unfold readable
  infer_instance

/-- The second snapshot is the DB lookup after R2 get/head completes. -/
def read (first final : Snapshot) (before after : Nat) (objectExists : Bool) : Snapshot × Bool :=
  (final, decide (readable first before ∧ objectExists = true ∧ readable final after))

theorem served_requires_final_check (first final : Snapshot) (before after : Nat)
    (objectExists : Bool) (h : (read first final before after objectExists).2 = true) :
    readable final after := by
  have guards : readable first before ∧ objectExists = true ∧ readable final after :=
    of_decide_eq_true h
  exact guards.2.2

theorem served_requires_initial_check (first final : Snapshot) (before after : Nat)
    (objectExists : Bool) (h : (read first final before after objectExists).2 = true) :
    readable first before := by
  have guards : readable first before ∧ objectExists = true ∧ readable final after :=
    of_decide_eq_true h
  exact guards.1

theorem readable_requires_presence_and_token (s : Snapshot) (now : Nat) (h : readable s now) :
    s.link.present = true ∧ s.link.tokenValid = true := ⟨h.1, h.2.1⟩

theorem readable_requires_current_pufu (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.present = true ∧ s.current.pufu = s.link.pufu :=
  ⟨h.2.2.2.2.1, h.2.2.2.2.2.1⟩

theorem readable_requires_pufu_ready (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.ready = true := h.2.2.2.2.2.2.2.2.2.1

theorem readable_requires_ready (s : Snapshot) (now : Nat) (h : readable s now) :
    s.link.ready = true := h.2.2.1

theorem readable_requires_unexpired (s : Snapshot) (now : Nat) (h : readable s now) :
    now < s.link.expires := h.2.2.2.1

theorem expiry_inclusive_refusal (s : Snapshot) (now : Nat) (h : s.link.expires ≤ now) :
    ¬ readable s now := by
  intro allowed
  exact Nat.not_lt_of_ge h (readable_requires_unexpired s now allowed)

theorem readable_requires_owner (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.pufuOwner = s.link.owner ∧ s.current.projectOwner = s.link.owner := by
  have current := h.2.2.2.2
  exact ⟨current.2.2.1, current.2.2.2.1⟩

theorem readable_requires_project (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.project = s.link.project := h.2.2.2.2.2.2.2.2.1

theorem readable_requires_phase (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.phase = s.link.phase := h.2.2.2.2.2.2.2.2.2.2.1

theorem readable_requires_revision (s : Snapshot) (now : Nat) (h : readable s now) :
    s.current.revision = s.link.revision := h.2.2.2.2.2.2.2.2.2.2.2.1

theorem readable_requires_relation (s : Snapshot) (now : Nat) (h : readable s now) :
    s.link.question = none ∨ s.current.questionRelated = true := h.2.2.2.2.2.2.2.2.2.2.2.2

theorem read_preserves_state (first final : Snapshot) (before after : Nat) (objectExists : Bool) :
    (read first final before after objectExists).1 = final := rfl

theorem late_invalidation_denied (first final : Snapshot) (before after : Nat)
    (objectExists : Bool) (invalid : ¬ readable final after) :
    (read first final before after objectExists).2 = false := by
  simp [read, invalid]

structure Issuer where
  user : Nat
  scopeAllowed : Bool
  pngAvailable : Bool
  activeLinks : Nat
  deriving DecidableEq, Repr

def issueAllowed (s : Snapshot) (issuer : Issuer) : Prop :=
  issuer.pngAvailable = true ∧ issuer.user = s.link.owner ∧
    issuer.scopeAllowed = true ∧ issuer.activeLinks < 50 ∧ currentMatches s.link s.current

instance (s : Snapshot) (issuer : Issuer) : Decidable (issueAllowed s issuer) := by
  unfold issueAllowed
  infer_instance

def reserve (s : Snapshot) (issuer : Issuer) : Option Link :=
  if issueAllowed s issuer then some { s.link with present := true, tokenValid := true, ready := false } else none

theorem reservation_pending (s : Snapshot) (issuer : Issuer) (l : Link)
    (h : reserve s issuer = some l) : l.ready = false := by
  unfold reserve at h
  split at h
  next => cases h; rfl
  next => cases h

theorem issue_denied_unchanged (s : Snapshot) (issuer : Issuer) (h : ¬ issueAllowed s issuer) :
    reserve s issuer = none := by simp [reserve, h]

theorem reservation_requires_scope (s : Snapshot) (issuer : Issuer) (l : Link)
    (h : reserve s issuer = some l) : issuer.scopeAllowed = true := by
  unfold reserve at h
  split at h
  next allowed => exact allowed.2.2.1
  next => cases h

theorem reservation_requires_owner (s : Snapshot) (issuer : Issuer) (l : Link)
    (h : reserve s issuer = some l) : issuer.user = s.link.owner := by
  unfold reserve at h
  split at h
  next allowed => exact allowed.2.1
  next => cases h

theorem reservation_requires_capacity (s : Snapshot) (issuer : Issuer) (l : Link)
    (h : reserve s issuer = some l) : issuer.activeLinks < 50 := by
  unfold reserve at h
  split at h
  next allowed => exact allowed.2.2.2.1
  next => cases h

def publishPending (s : Snapshot) (now : Nat) (stored : Bool) : Snapshot :=
  if s.link.present = true ∧ now < s.link.expires ∧ currentMatches s.link s.current ∧ stored = true then
    { s with link := { s.link with ready := true } }
  else s

theorem pending_publish_requires_current (s : Snapshot) (now : Nat) (stored : Bool)
    (pending : s.link.ready = false) (published : (publishPending s now stored).link.ready = true) :
    currentMatches s.link s.current := by
  unfold publishPending at published
  split at published
  next allowed => exact allowed.2.2.1
  next => simp [pending] at published

theorem pending_publish_requires_storage (s : Snapshot) (now : Nat) (stored : Bool)
    (pending : s.link.ready = false) (published : (publishPending s now stored).link.ready = true) :
    stored = true := by
  unfold publishPending at published
  split at published
  next allowed => exact allowed.2.2.2
  next => simp [pending] at published

theorem publish_preserves_business_data (s : Snapshot) (now : Nat) (stored : Bool) :
    let final := publishPending s now stored
    final.businessData = s.businessData ∧ final.history = s.history ∧ final.usage = s.usage := by
  simp only [publishPending]
  split <;> simp

theorem publicity_independent (s : Snapshot) (now : Nat) (visibility : Bool) :
    readable { s with projectPublic := visibility } now ↔ readable s now := Iff.rfl

def exampleLink : Link := ⟨true, true, true, 100, 1, 2, 3, 1, 4, none⟩
def exampleCurrent : Current := ⟨true, 3, 1, 1, 2, true, 1, 4, false⟩
def exampleSnapshot : Snapshot := ⟨exampleLink, exampleCurrent, false, 7, 8, 9⟩
def exampleIssuer : Issuer := ⟨1, true, true, 0⟩

theorem success_reachable :
    (read exampleSnapshot exampleSnapshot 1 2 true).2 = true ∧
    (reserve exampleSnapshot exampleIssuer).isSome = true ∧
    (publishPending { exampleSnapshot with link := { exampleLink with ready := false } } 2 true).link.ready = true := by decide

theorem refusal_reachable :
    (read exampleSnapshot exampleSnapshot 1 100 true).2 = false ∧
    reserve exampleSnapshot { exampleIssuer with scopeAllowed := false } = none ∧
    (publishPending { exampleSnapshot with link := { exampleLink with ready := false } } 2 false).link.ready = false := by decide

end Verification.ImageLink
