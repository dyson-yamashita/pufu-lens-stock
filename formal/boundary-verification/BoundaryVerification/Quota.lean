import Std

namespace BoundaryVerification.Quota

inductive Kind where
  | pufu | memory | article | question
  deriving DecidableEq, Repr

structure UsageRow where
  owner : Nat
  kind : Kind
  created : Nat
  deriving DecidableEq, Repr

-- SQL uses created_at > windowStart(), without a created_at <= now clause.
def counted (owner : Nat) (kind : Kind) (windowStart : Nat) (row : UsageRow) : Bool :=
  decide (row.owner = owner ∧ row.kind = kind ∧ windowStart < row.created)

def countRows (owner : Nat) (kind : Kind) (windowStart : Nat) (rows : List UsageRow) : Nat :=
  (rows.filter (counted owner kind windowStart)).length

inductive Status where
  | absent | pending | running | done | failed
  deriving DecidableEq, Repr

-- Pending manual reflections continue holding a slot reserved at acceptance.
-- The operations/jobs join and server-assigned job kind and ID are premises.
def activeJob (kind : Kind) (status : Status) (manualReflection : Bool) : Bool :=
  decide (status ≠ .done ∧ status ≠ .failed ∧
    ¬ (kind = .question ∧ status = .pending ∧ manualReflection = false))

structure Limits where
  operations : Nat
  jobs : Nat
  calls : Nat
  running : Nat
  deriving DecidableEq, Repr

structure Context where
  registeredAtAdmission : Bool
  customGuard : Bool
  activeJobsAtReservation : Nat
  otherActiveJobsAtAdmission : Nat
  limits : Limits
  deriving DecidableEq, Repr

-- Counters are aggregates for this trusted job's owner and current category.
-- Job-slot snapshots are separate in Context: reserveOperation counts all
-- active joins; question admission excludes the current job in its fresh SQL.
-- running counts all running ai_calls, even if their creation is old.
structure State where
  reservedOperation : Bool
  operations : Nat
  attempts : Nat
  running : Nat
  status : Status
  callAttempts : Nat
  retryBlocked : Bool
  metered : Bool
  businessRevision : Nat
  deriving DecidableEq, Repr

def operationGuard (c : Context) (s : State) : Prop :=
  c.registeredAtAdmission = true ∧ c.customGuard = true ∧
  s.operations < c.limits.operations ∧ c.activeJobsAtReservation < c.limits.jobs ∧
  s.attempts < c.limits.calls ∧ s.running < c.limits.running

instance (c : Context) (s : State) : Decidable (operationGuard c s) := by
  unfold operationGuard
  infer_instance

-- INSERT OR IGNORE: an existing operation is never counted a second time.
def reserveOperation (c : Context) (s : State) : State :=
  if s.reservedOperation = true then s
  else if operationGuard c s then
    { s with reservedOperation := true, operations := s.operations + 1 }
  else s

-- admitJob checks the registration of the reservation owner again. For an
-- existing non-question operation the daily operation quota is not rechecked.
def admitted (c : Context) (s : State) (question : Bool) : Prop :=
  s.reservedOperation = true ∧ c.registeredAtAdmission = true ∧
  (question = false ∨ c.otherActiveJobsAtAdmission < c.limits.jobs)

instance (c : Context) (s : State) (question : Bool) : Decidable (admitted c s question) := by
  unfold admitted
  infer_instance

def callGuard (c : Context) (s : State) (question : Bool) : Prop :=
  admitted c s question ∧ s.attempts < c.limits.calls ∧ s.running < c.limits.running ∧
  (s.status = .absent ∨
    (s.status = .failed ∧ s.callAttempts < 10 ∧ s.retryBlocked = false))

instance (c : Context) (s : State) (question : Bool) : Decidable (callGuard c s question) := by
  unfold callGuard
  infer_instance

-- Atomic ai_calls write + ai_attempts INSERT WHERE changes()=1.
def reserveCall (c : Context) (s : State) (question : Bool) : State :=
  if callGuard c s question then
    { s with
      attempts := s.attempts + 1
      running := s.running + 1
      status := .running
      callAttempts := s.callAttempts + 1
      metered := false }
  else s

-- The fresh registration read inside meteredOperation occurs AFTER reservation.
-- Failure may therefore leave an attempt and a failed call, without any AI run.
def executionAllowed (s : State) (registeredNow : Bool) : Prop :=
  s.reservedOperation = true ∧ s.status = .running ∧ registeredNow = true

instance (s : State) (registeredNow : Bool) : Decidable (executionAllowed s registeredNow) := by
  unfold executionAllowed
  infer_instance

inductive Outcome where
  | success | callbackFailure | unknownInvocation | registrationLost
  deriving DecidableEq, Repr

-- The callback's own business writes are outside this transition; only call
-- state and usage persistence are modeled. Meter persistence may itself fail.
def finishCall (s : State) (outcome : Outcome) (meterSaved : Bool) : State :=
  { s with
    running := s.running - 1
    status := if outcome = .success then .done else .failed
    retryBlocked := decide (outcome = .unknownInvocation)
    metered := outcome != .registrationLost && meterSaved }

structure MeterRow where
  id : Nat
  owner : Nat
  recorded : Bool
  micros : Nat
  complete : Bool
  deriving DecidableEq, Repr

-- saveAiUsage's owner/id check and write-once usage_model IS NULL guard.
def saveMeter (row : MeterRow) (attempt requester micros : Nat) (complete : Bool) : MeterRow :=
  if row.id = attempt ∧ row.owner = requester ∧ row.recorded = false then
    { row with recorded := true, micros := micros, complete := complete }
  else row

theorem window_boundary_excluded (owner : Nat) (kind : Kind) (boundary : Nat) :
    counted owner kind boundary ⟨owner, kind, boundary⟩ = false := by
  simp [counted]

theorem another_owner_excluded (owner : Nat) (kind : Kind) (boundary : Nat) (r : UsageRow)
    (h : r.owner ≠ owner) : counted owner kind boundary r = false := by
  simp [counted, h]

theorem pending_automatic_question_is_not_active :
    activeJob .question .pending false = false := by decide

theorem pending_manual_reflection_is_active :
    activeJob .question .pending true = true := by decide

theorem rejected_operation_preserves_state (c : Context) (s : State)
    (h : ¬ operationGuard c s) : reserveOperation c s = s := by
  simp [reserveOperation, h]

theorem operation_replay_does_not_recount (c : Context) (s : State)
    (h : s.reservedOperation = true) : reserveOperation c s = s := by
  simp [reserveOperation, h]

theorem new_operation_records_once (c : Context) (s : State)
    (hn : s.reservedOperation = false) (h : operationGuard c s) :
    (reserveOperation c s).reservedOperation = true ∧
    (reserveOperation c s).operations = s.operations + 1 := by
  simp [reserveOperation, hn, h]

theorem new_operation_needs_registration (c : Context) (s : State)
    (h : operationGuard c s) : c.registeredAtAdmission = true := by
  exact h.1

theorem new_operation_respects_limit (c : Context) (s : State)
    (h : operationGuard c s) : s.operations + 1 ≤ c.limits.operations := by
  have bound := h.2.2.1
  omega

theorem new_call_respects_limits (c : Context) (s : State) (question : Bool)
    (h : callGuard c s question) :
    s.attempts + 1 ≤ c.limits.calls ∧ s.running + 1 ≤ c.limits.running := by
  have calls := h.2.1
  have running := h.2.2.1
  omega

theorem accepted_call_records_attempt (c : Context) (s : State) (question : Bool)
    (h : callGuard c s question) :
    (reserveCall c s question).attempts = s.attempts + 1 ∧
    (reserveCall c s question).running = s.running + 1 ∧
    (reserveCall c s question).status = .running := by
  simp [reserveCall, h]

theorem reserved_call_within_limits (c : Context) (s : State) (question : Bool)
    (h : callGuard c s question) :
    (reserveCall c s question).attempts ≤ c.limits.calls ∧
    (reserveCall c s question).running ≤ c.limits.running := by
  simpa [reserveCall, h] using new_call_respects_limits c s question h

theorem rejected_call_preserves_state (c : Context) (s : State) (question : Bool)
    (h : ¬ callGuard c s question) : reserveCall c s question = s := by
  simp [reserveCall, h]

theorem running_call_cannot_be_reserved_twice (c : Context) (s : State) (question : Bool)
    (h : s.status = .running) : reserveCall c s question = s := by
  have denied : ¬ callGuard c s question := by
    intro hg
    rcases hg.2.2.2 with absent | failed
    · simp [h] at absent
    · simp [h] at failed
  exact rejected_call_preserves_state c s question denied

theorem completed_result_reuse_does_not_reserve (c : Context) (s : State) (question : Bool)
    (h : s.status = .done) : reserveCall c s question = s := by
  have denied : ¬ callGuard c s question := by
    intro hg
    rcases hg.2.2.2 with absent | failed
    · simp [h] at absent
    · simp [h] at failed
  exact rejected_call_preserves_state c s question denied

theorem reservation_preserves_business_revision (c : Context) (s : State) (question : Bool) :
    (reserveCall c s question).businessRevision = s.businessRevision := by
  unfold reserveCall
  split <;> rfl

theorem invocation_requires_current_registration (s : State) (registeredNow : Bool)
    (h : executionAllowed s registeredNow) : registeredNow = true := by
  exact h.2.2

theorem failure_keeps_attempt_charge (s : State) (outcome : Outcome) (saved : Bool) :
    (finishCall s outcome saved).attempts = s.attempts := by
  rfl

theorem unknown_invocation_blocks_retry (c : Context) (s : State) (question : Bool)
    (saved : Bool) :
    reserveCall c (finishCall s .unknownInvocation saved) question =
      finishCall s .unknownInvocation saved := by
  apply rejected_call_preserves_state
  simp [callGuard, finishCall]

theorem lost_registration_does_not_create_meter (s : State) (saved : Bool) :
    (finishCall s .registrationLost saved).metered = false := by
  simp [finishCall]

theorem wrong_owner_cannot_save_meter (row : MeterRow) (attempt requester micros : Nat)
    (complete : Bool) (h : row.owner ≠ requester) :
    saveMeter row attempt requester micros complete = row := by
  simp [saveMeter, h]

theorem recorded_meter_is_write_once (row : MeterRow) (attempt requester micros : Nat)
    (complete : Bool) (h : row.recorded = true) :
    saveMeter row attempt requester micros complete = row := by
  simp [saveMeter, h]

def normalContext : Context := ⟨true, true, 0, 0, ⟨2, 2, 2, 1⟩⟩
def emptyState : State := ⟨false, 0, 0, 0, .absent, 0, false, false, 7⟩

theorem reservation_and_call_success_reachable :
    let op := reserveOperation normalContext emptyState
    let call := reserveCall normalContext op false
    call.attempts = 1 ∧ call.running = 1 ∧
    (finishCall call .success true).status = .done ∧
    (finishCall call .success true).metered = true := by
  decide

theorem rejected_operation_reachable :
    reserveOperation { normalContext with registeredAtAdmission := false } emptyState =
      emptyState := by
  decide

theorem registration_loss_after_reservation_reachable :
    let op := reserveOperation normalContext emptyState
    let call := reserveCall normalContext op false
    ¬ executionAllowed call false ∧
    (finishCall call .registrationLost false).attempts = 1 ∧
    (finishCall call .registrationLost false).status = .failed ∧
    (finishCall call .registrationLost false).metered = false := by
  decide

end BoundaryVerification.Quota
