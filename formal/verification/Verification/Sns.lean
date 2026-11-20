import Verification.Auth

namespace Verification.Sns

inductive Principal where
  | session | shortcut | mcp | anonymous
  deriving DecidableEq, Repr

structure Management where
  principal : Principal
  identity : Auth.SessionPrincipal
  originTrusted : Bool
  deriving DecidableEq, Repr

def mayInspect (r : Management) : Bool :=
  r.principal == .session && r.identity.onboarded

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
def put (s : State) (r : Management) (secret stamp : Nat) : State :=
  if mayChange r then
    { s with credentials := fun owner =>
        if owner == r.identity.userId then
          some ⟨r.identity.userId, secret, true, stamp⟩ else s.credentials owner }
  else s

def erase (s : State) (r : Management) : State :=
  if mayChange r then
    { s with credentials := fun owner =>
        if owner == r.identity.userId then none else s.credentials owner }
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
  have guards : r.principal = .session ∧ r.identity.onboarded = true := by
    simpa [mayInspect] using h
  exact guards.1

theorem rejected_management_unchanged (s : State) (r : Management) (secret stamp : Nat)
    (h : mayChange r = false) : put s r secret stamp = s ∧ erase s r = s := by
  simp [put, erase, h]

theorem put_owner_only (s : State) (r : Management) (other secret stamp : Nat)
    (h : other ≠ r.identity.userId) :
    (put s r secret stamp).credentials other = s.credentials other := by
  cases decision : mayChange r <;> simp [put, decision, h]

theorem erase_owner_only (s : State) (r : Management) (other : Nat)
    (h : other ≠ r.identity.userId) :
    (erase s r).credentials other = s.credentials other := by
  cases decision : mayChange r <;> simp [erase, decision, h]

theorem put_loads_same_user (s : State) (r : Management) (secret stamp : Nat)
    (h : mayChange r = true) :
    load (put s r secret stamp) r.identity.userId = some secret := by
  simp [put, load, h]

theorem authenticated_put_binds_owner (s : State) (row : Auth.SessionRow)
    (user : Auth.SessionUser) (presentedHash authTime secret stamp : Nat)
    (p : Auth.SessionPrincipal) (origin : Bool)
    (success : Auth.authenticateSession (some row) (some user) presentedHash authTime = some p)
    (allowed : mayChange ⟨.session, p, origin⟩ = true) :
    (put s ⟨.session, p, origin⟩ secret stamp).credentials row.owner =
      some ⟨row.owner, secret, true, stamp⟩ := by
  have identity := (Auth.authenticated_session_matches_row row user presentedHash authTime p success).1
  simp [put, allowed, identity]

theorem authenticated_other_owner_unchanged (s : State) (row : Auth.SessionRow)
    (user : Auth.SessionUser) (presentedHash authTime secret stamp other : Nat)
    (p : Auth.SessionPrincipal) (origin : Bool)
    (success : Auth.authenticateSession (some row) (some user) presentedHash authTime = some p)
    (different : other ≠ row.owner) :
    (put s ⟨.session, p, origin⟩ secret stamp).credentials other = s.credentials other ∧
    (erase s ⟨.session, p, origin⟩).credentials other = s.credentials other := by
  have identity := (Auth.authenticated_session_matches_row row user presentedHash authTime p success).1
  have otherActor : other ≠ p.userId := by simpa [identity] using different
  exact ⟨put_owner_only s _ other secret stamp otherActor, erase_owner_only s _ other otherActor⟩

theorem copied_cipher_rejected (s : State) (u : Nat) (c : Cipher)
    (row : s.credentials u = some c) (h : c.aadUser ≠ u) : load s u = none := by
  simp [load, row, h]

theorem erased_new_load_rejected (s : State) (r : Management)
    (h : mayChange r = true) : load (erase s r) r.identity.userId = none := by
  simp [erase, load, h]

theorem put_business_unchanged (s : State) (r : Management) (secret stamp : Nat) :
    (put s r secret stamp).businessRevision = s.businessRevision := by
  cases decision : mayChange r <;> simp [put, decision]

theorem public_status_ignores_secret (s : State) (r : Management) (a b stamp : Nat)
    (h : mayChange r = true) (available : Bool) :
    inspect (put s r a stamp) r.identity.userId available =
      inspect (put s r b stamp) r.identity.userId available := by
  simp [inspect, put, h]

theorem registered_is_configured (s : State) (r : Management) (secret stamp : Nat)
    (h : mayChange r = true) (available : Bool) :
    (inspect (put s r secret stamp) r.identity.userId available).configured = true := by
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
def session : Management := ⟨.session, ⟨1, 11, 100, true⟩, true⟩

theorem reachable_registered_and_erased :
    load (put empty session 123 9) 1 = some 123 ∧
    load (erase (put empty session 123 9) session) 1 = none := by
  decide

theorem reachable_mcp_denial :
    (put empty { session with principal := .mcp } 123 9).credentials 1 = none := by
  decide

theorem reachable_authenticated_update_preserves_other :
    Auth.authenticateSession (some ⟨1, 11, 100⟩) (some ⟨1, true⟩) 11 10 =
      some session.identity ∧
    let initial := put empty { session with identity := ⟨2, 22, 100, true⟩ } 222 8
    load (put initial session 123 9) 1 = some 123 ∧
      (put initial session 123 9).credentials 2 = initial.credentials 2 ∧
      (erase (put initial session 123 9) session).credentials 2 = initial.credentials 2 := by
  decide

theorem reachable_fetch_and_auth_denial :
    fetchResult (some 123) ⟨200, true, true, true⟩ = .article ∧
    fetchResult (some 123) ⟨401, true, true, true⟩ = .rejected := by
  decide

end Verification.Sns
