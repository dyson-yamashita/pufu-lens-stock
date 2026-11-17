import BoundaryVerification.Auth

namespace BoundaryVerification.Push

structure Subscription where
  owner : Nat
  session : Nat
  expiresAt : Nat
  deriving DecidableEq, Repr

structure Registration where
  sessionPrincipal : Bool
  sessionHashPresent : Bool
  configured : Bool
  endpointAllowed : Bool
  keyValid : Bool
  principal : Auth.SessionPrincipal
  deriving DecidableEq, Repr

structure DeviceState where
  subscription : Option Subscription
  businessRevision : Nat
  deriving DecidableEq, Repr

def registrationValid (r : Registration) : Bool :=
  r.sessionPrincipal && r.sessionHashPresent && r.configured && r.endpointAllowed && r.keyValid

/-- Expiry cleanup precedes the endpoint conflict check. Count is measured after cleanup. -/
def cleanExpired (s : DeviceState) (now : Nat) : DeviceState :=
  match s.subscription with
  | some p => if p.expiresAt ≤ now then { s with subscription := none } else s
  | none => s

def ownsOrUnused (s : DeviceState) (user : Nat) : Bool :=
  match s.subscription with
  | none => true
  | some p => p.owner == user

def deviceLimitAllows (s : DeviceState) (user count : Nat) : Bool :=
  count < 20 || (s.subscription.any fun p => p.owner == user)

def register (s : DeviceState) (r : Registration) (now countAfterCleanup : Nat) : DeviceState :=
  if registrationValid r then
    let cleaned := cleanExpired s now
    if ownsOrUnused cleaned r.principal.userId &&
        deviceLimitAllows cleaned r.principal.userId countAfterCleanup then
      { cleaned with subscription := some ⟨r.principal.userId, r.principal.sessionHash, r.principal.expiresAt⟩ }
    else cleaned
  else s

def unsubscribe (s : DeviceState) (user : Nat) : DeviceState :=
  if s.subscription.any (fun p => p.owner == user) then { s with subscription := none } else s

def logout (s : DeviceState) (session : Nat) : DeviceState :=
  if s.subscription.any (fun p => p.session == session) then { s with subscription := none } else s

def subscribed (s : DeviceState) (user now : Nat) : Bool :=
  s.subscription.any fun p => p.owner == user && now < p.expiresAt

theorem registration_requires_session (r : Registration) (h : registrationValid r = true) :
    r.sessionPrincipal = true ∧ r.sessionHashPresent = true := by
  simp [registrationValid] at h
  exact ⟨h.1.1.1.1, h.1.1.1.2⟩

theorem invalid_registration_unchanged (s : DeviceState) (r : Registration) (now count : Nat)
    (h : registrationValid r = false) : register s r now count = s := by
  simp [register, h]

theorem register_binds_current_session (s : DeviceState) (r : Registration) (now count : Nat)
    (valid : registrationValid r = true)
    (owner : ownsOrUnused (cleanExpired s now) r.principal.userId = true)
    (limit : deviceLimitAllows (cleanExpired s now) r.principal.userId count = true) :
    (register s r now count).subscription = some
      ⟨r.principal.userId, r.principal.sessionHash, r.principal.expiresAt⟩ := by
  simp [register, valid, owner, limit]

theorem authenticated_registration_matches_session_row (s : DeviceState)
    (row : Auth.SessionRow) (user : Auth.SessionUser) (presentedHash authTime : Nat)
    (r : Registration) (registrationTime count : Nat)
    (success : Auth.authenticateSession (some row) (some user) presentedHash authTime =
      some r.principal)
    (valid : registrationValid r = true)
    (owner : ownsOrUnused (cleanExpired s registrationTime) r.principal.userId = true)
    (limit : deviceLimitAllows (cleanExpired s registrationTime) r.principal.userId count = true) :
    (register s r registrationTime count).subscription =
      some ⟨row.owner, row.tokenHash, row.expiresAt⟩ := by
  have identity := Auth.authenticated_session_matches_row row user presentedHash authTime r.principal success
  have bound : (register s r registrationTime count).subscription =
      some ⟨r.principal.userId, r.principal.sessionHash, r.principal.expiresAt⟩ := by
    simp [register, valid, owner, limit]
  simpa [identity.1, identity.2.1, identity.2.2.1] using bound

theorem other_owner_registration_rejected (s : DeviceState) (r : Registration)
    (now count : Nat) (p : Subscription) (row : s.subscription = some p)
    (live : now < p.expiresAt) (other : p.owner ≠ r.principal.userId) : register s r now count = s := by
  have expiry : ¬ p.expiresAt ≤ now := by omega
  cases valid : registrationValid r <;>
    simp [register, valid, cleanExpired, row, expiry, ownsOrUnused, other]

theorem new_device_limit_rejected (r : Registration) (now count revision : Nat)
    (full : 20 ≤ count) : register ⟨none, revision⟩ r now count = ⟨none, revision⟩ := by
  have limit : ¬ count < 20 := by omega
  cases valid : registrationValid r <;>
    simp [register, valid, cleanExpired, ownsOrUnused, deviceLimitAllows, limit]

theorem registration_business_unchanged (s : DeviceState) (r : Registration) (now count : Nat) :
    (register s r now count).businessRevision = s.businessRevision := by
  have clean : (cleanExpired s now).businessRevision = s.businessRevision := by
    unfold cleanExpired
    split
    next => split <;> rfl
    next => rfl
  unfold register
  split
  next =>
    dsimp only
    split <;> simp [clean]
  next => rfl

theorem other_owner_unsubscribe_unchanged (s : DeviceState) (user : Nat) (p : Subscription)
    (row : s.subscription = some p) (other : p.owner ≠ user) : unsubscribe s user = s := by
  simp [unsubscribe, row, other]

theorem logout_removes_bound_subscription (s : DeviceState) (p : Subscription)
    (row : s.subscription = some p) : (logout s p.session).subscription = none := by
  simp [logout, row]

theorem expiry_boundary_not_subscribed (s : DeviceState) (user now : Nat) (p : Subscription)
    (row : s.subscription = some p) (expired : p.expiresAt ≤ now) :
    subscribed s user now = false := by
  have h : ¬ now < p.expiresAt := by omega
  simp [subscribed, row, h]

inductive DeliveryStatus where
  | pending | sending | sent | failed
  deriving DecidableEq, Repr

structure Delivery where
  status : DeliveryStatus
  attempts : Nat
  lease : Option Nat
  nextAttempt : Nat
  deriving DecidableEq, Repr

def bounded (d : Delivery) : Prop :=
  d.attempts ≤ 5 ∧ (d.status = .pending → d.attempts < 5)

/-- The SQL claim increments only a due pending row; the bound is a reachable-state invariant. -/
def claim (d : Delivery) (now lease : Nat) : Delivery :=
  if d.status == .pending && d.nextAttempt ≤ now then
    { d with
      status := .sending
      attempts := d.attempts + 1
      lease := some lease
      nextAttempt := now + 120 }
  else d

def recover (d : Delivery) (now : Nat) : Delivery :=
  if d.status == .sending && d.nextAttempt ≤ now then
    { d with status := if d.attempts ≥ 5 then .failed else .pending, lease := none }
  else d

def retriable (status : Nat) : Bool := status == 0 || status == 429 || 500 ≤ status

def finish (d : Delivery) (lease status next : Nat) : Delivery :=
  if d.lease == some lease then
    { d with
      status := if 200 ≤ status && status < 300 then .sent
        else if retriable status && d.attempts < 5 then .pending else .failed
      lease := none
      nextAttempt := next }
  else d

theorem claim_increments_once (d : Delivery) (now lease : Nat)
    (pending : d.status = .pending) (due : d.nextAttempt ≤ now) :
    (claim d now lease).attempts = d.attempts + 1 ∧
    claim (claim d now lease) now (lease + 1) = claim d now lease := by
  simp [claim, pending, due]

theorem stale_lease_cannot_complete (d : Delivery) (lease status next : Nat)
    (stale : d.lease ≠ some lease) : finish d lease status next = d := by
  simp [finish, stale]

theorem claim_preserves_bound (d : Delivery) (now lease : Nat) (h : bounded d) :
    bounded (claim d now lease) := by
  unfold claim
  split
  next guard =>
    have pending : d.status = .pending := by simpa using (Bool.and_eq_true_iff.mp guard).1
    have n := h.2 pending
    simp only [bounded, reduceCtorEq, false_implies, and_true]
    omega
  next => exact h

theorem exhausted_retry_fails (d : Delivery) (lease next : Nat)
    (owned : d.lease = some lease) (exhausted : d.attempts = 5) :
    (finish d lease 503 next).status = .failed := by
  simp [finish, owned, exhausted]

theorem expired_fifth_lease_fails (d : Delivery) (now : Nat)
    (sending : d.status = .sending) (due : d.nextAttempt ≤ now) (n : d.attempts = 5) :
    (recover d now).status = .failed ∧ (recover d now).lease = none := by
  simp [recover, sending, due, n]

theorem recover_preserves_bound (d : Delivery) (now : Nat) (h : bounded d) :
    bounded (recover d now) := by
  unfold recover
  split
  next =>
    dsimp [bounded]
    split <;> simp_all [bounded]
  next => exact h

theorem finish_preserves_bound (d : Delivery) (lease status next : Nat) (h : bounded d) :
    bounded (finish d lease status next) := by
  unfold finish
  split
  next =>
    dsimp [bounded]
    split
    next => simp [h.1]
    next =>
      split
      next guard =>
        have n : d.attempts < 5 := by simpa using (Bool.and_eq_true_iff.mp guard).2
        simp [h.1, n]
      next => simp [h.1]
  next => exact h

structure Preflight where
  subscriptionExists : Bool
  sessionExpires : Nat
  announcementExists : Bool
  notify : Bool
  notifyAt : Nat
  publishedAt : Nat
  deriving DecidableEq, Repr

/-- This is the final SQL snapshot after signing/encryption, immediately before fetch. -/
def maySend (p : Preflight) (now selectedNotifyAt : Nat) : Bool :=
  p.subscriptionExists && now < p.sessionExpires && p.announcementExists && p.notify &&
    p.notifyAt == selectedNotifyAt && p.publishedAt ≤ now

theorem send_requires_current_consent (p : Preflight) (now stamp : Nat)
    (h : maySend p now stamp = true) :
    p.subscriptionExists = true ∧ now < p.sessionExpires ∧ p.announcementExists = true ∧
      p.notify = true ∧ p.notifyAt = stamp ∧ p.publishedAt ≤ now := by
  simpa [maySend, and_assoc] using h

theorem unsubscribe_before_preflight_rejects (p : Preflight) (now stamp : Nat)
    (h : p.subscriptionExists = false) : maySend p now stamp = false := by
  simp [maySend, h]

theorem expiry_before_preflight_rejects (p : Preflight) (now stamp : Nat)
    (h : p.sessionExpires ≤ now) : maySend p now stamp = false := by
  have expiry : ¬ now < p.sessionExpires := by omega
  simp [maySend, expiry]

theorem notification_changed_before_preflight_rejects (p : Preflight) (now stamp : Nat)
    (h : p.notifyAt ≠ stamp) : maySend p now stamp = false := by
  simp [maySend, h]

def emptyDevice : DeviceState := ⟨none, 7⟩
def sessionRegistration : Registration := ⟨true, true, true, true, true, ⟨1, 11, 100, true⟩⟩

theorem reachable_register_logout_and_denial :
    (register emptyDevice sessionRegistration 10 0).subscription = some ⟨1, 11, 100⟩ ∧
    (logout (register emptyDevice sessionRegistration 10 0) 11).subscription = none ∧
    register ⟨some ⟨2, 22, 100⟩, 7⟩ sessionRegistration 10 1 = ⟨some ⟨2, 22, 100⟩, 7⟩ := by
  decide

theorem reachable_authenticated_registration :
    Auth.authenticateSession (some ⟨1, 11, 100⟩) (some ⟨1, true⟩) 11 10 =
      some sessionRegistration.principal ∧
    (register emptyDevice sessionRegistration 20 0).subscription = some ⟨1, 11, 100⟩ ∧
    register emptyDevice { sessionRegistration with sessionPrincipal := false } 20 0 = emptyDevice := by
  decide

theorem reachable_delivery_success_and_denial :
    (finish (claim ⟨.pending, 0, none, 0⟩ 10 42) 42 201 100).status = .sent ∧
    (finish (claim ⟨.pending, 4, none, 0⟩ 10 42) 42 503 100).status = .failed ∧
    maySend ⟨true, 100, true, true, 5, 5⟩ 10 5 = true ∧
    maySend ⟨false, 100, true, true, 5, 5⟩ 10 5 = false := by
  decide

end BoundaryVerification.Push
