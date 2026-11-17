import Std

namespace BoundaryVerification.Sns

inductive Principal where
  | session | shortcut | mcp | anonymous
  deriving DecidableEq, Repr

structure Management where
  principal : Principal
  onboarded : Bool
  originTrusted : Bool
  deriving DecidableEq, Repr

def mayInspect (r : Management) : Bool :=
  r.principal == .session && r.onboarded

def mayChange (r : Management) : Bool :=
  mayInspect r && r.originTrusted

/-- Cipher fields abstract an authenticated AES-GCM envelope; cryptography is not proved. -/
structure Cipher where
  aadUser : Nat
  secret : Nat
  authentic : Bool
  updatedAt : Nat
  deriving DecidableEq, Repr

structure State where
  credentials : Nat → Option Cipher
  businessRevision : Nat

/-- The database lookup is keyed by the authenticated user's ID and provider x. -/
def put (s : State) (r : Management) (user secret stamp : Nat) : State :=
  if mayChange r then
    { s with credentials := fun owner =>
        if owner == user then some ⟨user, secret, true, stamp⟩ else s.credentials owner }
  else s

def erase (s : State) (r : Management) (user : Nat) : State :=
  if mayChange r then
    { s with credentials := fun owner =>
        if owner == user then none else s.credentials owner }
  else s

def load (s : State) (user : Nat) : Option Nat :=
  match s.credentials user with
  | none => none
  | some cipher =>
      if cipher.aadUser == user && cipher.authentic then some cipher.secret else none

structure PublicStatus where
  configured : Bool
  available : Bool
  updatedAt : Option Nat
  deriving DecidableEq, Repr

/-- configured records local row presence, without making a request to X. -/
def inspect (s : State) (user : Nat) (keyAvailable : Bool) : PublicStatus :=
  { configured := (s.credentials user).isSome
    available := keyAvailable
    updatedAt := (s.credentials user).map Cipher.updatedAt }

theorem management_requires_session (r : Management) (h : mayInspect r = true) :
    r.principal = .session := by
  have guards : r.principal = .session ∧ r.onboarded = true := by
    simpa [mayInspect] using h
  exact guards.1

theorem rejected_management_unchanged (s : State) (r : Management) (u secret stamp : Nat)
    (h : mayChange r = false) : put s r u secret stamp = s ∧ erase s r u = s := by
  simp [put, erase, h]

theorem put_owner_only (s : State) (r : Management) (u other secret stamp : Nat)
    (h : other ≠ u) : (put s r u secret stamp).credentials other = s.credentials other := by
  cases decision : mayChange r <;> simp [put, decision, h]

theorem put_loads_same_user (s : State) (r : Management) (u secret stamp : Nat)
    (h : mayChange r = true) : load (put s r u secret stamp) u = some secret := by
  simp [put, load, h]

theorem copied_cipher_rejected (s : State) (u : Nat) (c : Cipher)
    (row : s.credentials u = some c) (h : c.aadUser ≠ u) : load s u = none := by
  simp [load, row, h]

theorem erased_new_load_rejected (s : State) (r : Management) (u : Nat)
    (h : mayChange r = true) : load (erase s r u) u = none := by
  simp [erase, load, h]

theorem put_business_unchanged (s : State) (r : Management) (u secret stamp : Nat) :
    (put s r u secret stamp).businessRevision = s.businessRevision := by
  cases decision : mayChange r <;> simp [put, decision]

theorem public_status_ignores_secret (s : State) (r : Management) (u a b stamp : Nat)
    (h : mayChange r = true) (available : Bool) :
    inspect (put s r u a stamp) u available = inspect (put s r u b stamp) u available := by
  simp [inspect, put, h]

theorem registered_is_configured (s : State) (r : Management) (u secret stamp : Nat)
    (h : mayChange r = true) (available : Bool) :
    (inspect (put s r u secret stamp) u available).configured = true := by
  simp [inspect, put, h]

inductive FetchResult where
  | rejected
  | article
  deriving DecidableEq, Repr

structure ProviderResponse where
  status : Nat
  idMatches : Bool
  nonemptyText : Bool
  withinLimit : Bool
  deriving DecidableEq, Repr

/-- All errors use fixed local messages; neither token nor provider body is returned. -/
def fetchResult (token : Option Nat) (r : ProviderResponse) : FetchResult :=
  if token.isSome && (200 ≤ r.status && r.status < 300) &&
      r.idMatches && r.nonemptyText && r.withinLimit then .article else .rejected

theorem fetch_success_guards (token : Option Nat) (r : ProviderResponse)
    (h : fetchResult token r = .article) :
    token.isSome = true ∧ 200 ≤ r.status ∧ r.status < 300 ∧
      r.idMatches = true ∧ r.nonemptyText = true ∧ r.withinLimit = true := by
  simpa [fetchResult, and_assoc] using h

theorem unauthorized_rejected (token : Option Nat) (id text size : Bool) :
    fetchResult token ⟨401, id, text, size⟩ = .rejected := by
  simp [fetchResult]

theorem redirect_rejected (token : Option Nat) (id text size : Bool) :
    fetchResult token ⟨302, id, text, size⟩ = .rejected := by
  simp [fetchResult]

theorem missing_token_rejected (r : ProviderResponse) :
    fetchResult none r = .rejected := by
  simp [fetchResult]

theorem response_does_not_expose_token (a b : Nat) (r : ProviderResponse) :
    fetchResult (some a) r = fetchResult (some b) r := by
  rfl

inductive Authority where
  | xApi | other
  deriving DecidableEq, Repr
inductive RedirectPolicy where
  | manual | follow
  deriving DecidableEq, Repr
structure Outgoing where
  authority : Authority
  redirect : RedirectPolicy
  bearer : Nat
  deriving DecidableEq, Repr

def outgoing (secret : Nat) : Outgoing := ⟨.xApi, .manual, secret⟩

theorem outgoing_fixed_manual (secret : Nat) :
    (outgoing secret).authority = .xApi ∧ (outgoing secret).redirect = .manual := by
  exact ⟨rfl, rfl⟩

def empty : State := ⟨fun _ => none, 7⟩
def session : Management := ⟨.session, true, true⟩

theorem reachable_registered_and_erased :
    load (put empty session 1 123 9) 1 = some 123 ∧
    load (erase (put empty session 1 123 9) session 1) 1 = none := by
  decide

theorem reachable_mcp_denial :
    (put empty ⟨.mcp, true, true⟩ 1 123 9).credentials 1 = none := by
  decide

theorem reachable_fetch_and_auth_denial :
    fetchResult (some 123) ⟨200, true, true, true⟩ = .article ∧
    fetchResult (some 123) ⟨401, true, true, true⟩ = .rejected := by
  decide

end BoundaryVerification.Sns
