import Std

namespace Verification.McpWrites

-- Scope is checked by run; ownership and project range are checked again in SQL.
structure Access where
  writeScope : Bool
  ownsTarget : Bool
  projectAllowed : Bool
  deriving Repr, DecidableEq

def canWrite (a : Access) : Bool :=
  a.writeScope && a.ownsTarget && a.projectAllowed

-- Normalized relation IDs retain request_json's legacy/explicit field shape.
-- One actor/request_id is tracked.
structure CreatePayload where
  project : Nat
  score : Nat
  title : Nat
  questions : List Nat
  stocks : List Nat
  explicitRelations : Bool
  deriving Repr, DecidableEq

structure CreatedPufu where
  original : CreatePayload
  revision : Nat
  currentPhase : Nat
  phases : List Nat
  deriving Repr, DecidableEq

structure CreateState where
  saved : Option CreatedPufu
  deriving Repr, DecidableEq

structure CreateResult where
  accepted : Bool
  created : Bool
  state : CreateState
  deriving Repr, DecidableEq

def create (a : Access) (s : CreateState) (p : CreatePayload) : CreateResult :=
  if canWrite a then
    match s.saved with
    | some row =>
        if row.original = p then ⟨true, false, s⟩ else ⟨false, false, s⟩
    | none =>
        ⟨true, true, ⟨some ⟨p, 1, 1, [p.score]⟩⟩⟩
  else ⟨false, false, s⟩

theorem create_missing_scope (a : Access) (s : CreateState) (p : CreatePayload)
    (h : a.writeScope = false) : create a s p = ⟨false, false, s⟩ := by
  simp [create, canWrite, h]

theorem create_replay (a : Access) (s : CreateState) (p : CreatePayload)
    (row : CreatedPufu) (ha : canWrite a = true)
    (hs : s.saved = some row) (hp : row.original = p) :
    create a s p = ⟨true, false, s⟩ := by
  simp [create, ha, hs, hp]

theorem create_payload_conflict (a : Access) (s : CreateState) (p : CreatePayload)
    (row : CreatedPufu) (ha : canWrite a = true)
    (hs : s.saved = some row) (hp : row.original ≠ p) :
    create a s p = ⟨false, false, s⟩ := by
  simp [create, ha, hs, hp]

theorem create_request_shape_conflict (a : Access) (s : CreateState) (p : CreatePayload)
    (row : CreatedPufu) (ha : canWrite a = true) (hs : s.saved = some row)
    (hshape : row.original.explicitRelations ≠ p.explicitRelations) :
    create a s p = ⟨false, false, s⟩ := by
  have hp : row.original ≠ p := by
    intro heq
    exact hshape (congrArg CreatePayload.explicitRelations heq)
  simp [create, ha, hs, hp]

theorem create_first_phase (a : Access) (s : CreateState) (p : CreatePayload)
    (ha : canWrite a = true) (hs : s.saved = none) :
    create a s p = ⟨true, true, ⟨some ⟨p, 1, 1, [p.score]⟩⟩⟩ := by
  simp [create, ha, hs]

theorem create_rejected_unchanged (a : Access) (s : CreateState) (p : CreatePayload)
    (h : (create a s p).accepted = false) : (create a s p).state = s := by
  by_cases ha : canWrite a = true
  · cases hs : s.saved with
    | none => simp [create, ha, hs] at h
    | some row =>
        by_cases hp : row.original = p <;> simp [create, ha, hs, hp]
  · simp [create, ha]

structure PhaseRequest where
  requestId : Nat
  pufuId : Nat
  revision : Nat
  replacement : Option Nat
  reason : Option Nat
  deriving Repr, DecidableEq

structure Receipt where
  request : PhaseRequest
  phase : Nat
  revision : Nat
  deriving Repr, DecidableEq

structure PhaseState where
  ready : Bool
  revision : Nat
  currentPhase : Nat
  latestData : Nat
  phases : Nat → Option Nat
  comments : List (Nat × Nat)
  relations : List Nat
  receipts : List Receipt

structure PhaseResult where
  accepted : Bool
  created : Bool
  phase : Nat
  revision : Nat
  state : PhaseState

def receiptFor (s : PhaseState) (r : PhaseRequest) : Option Receipt :=
  s.receipts.find? (fun receipt => receipt.request.requestId == r.requestId)

def denied (s : PhaseState) : PhaseResult := ⟨false, false, 0, 0, s⟩

def commit (s : PhaseState) (r : PhaseRequest) : PhaseState :=
  let data := r.replacement.getD s.latestData
  { ready := s.ready
    revision := s.revision + 1
    currentPhase := s.currentPhase + 1
    latestData := data
    phases := fun n => if n = s.currentPhase + 1 then some data else s.phases n
    comments := match r.reason with
      | none => s.comments
      | some reason => s.comments ++ [(s.currentPhase + 1, reason)]
    relations := s.relations
    receipts := ⟨r, s.currentPhase + 1, s.revision + 1⟩ :: s.receipts }

def append (a : Access) (s : PhaseState) (r : PhaseRequest) : PhaseResult :=
  if canWrite a then
    match receiptFor s r with
    | some receipt =>
        if receipt.request = r then
          ⟨true, false, receipt.phase, receipt.revision, s⟩
        else denied s
    | none =>
        if s.ready = true ∧ r.revision = s.revision then
          ⟨true, true, s.currentPhase + 1, s.revision + 1, commit s r⟩
        else denied s
  else denied s

theorem append_missing_scope (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : a.writeScope = false) : append a s r = denied s := by
  simp [append, canWrite, h]

theorem append_non_owner (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : a.ownsTarget = false) : append a s r = denied s := by
  simp [append, canWrite, h]

theorem append_outside_project (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : a.projectAllowed = false) : append a s r = denied s := by
  simp [append, canWrite, h]

-- Receipt lookup precedes readiness/revision checks, even after subsequent writes.
theorem append_replay_original_result (a : Access) (s : PhaseState) (r : PhaseRequest)
    (receipt : Receipt) (ha : canWrite a = true)
    (hs : receiptFor s r = some receipt) (hr : receipt.request = r) :
    append a s r = ⟨true, false, receipt.phase, receipt.revision, s⟩ := by
  simp [append, ha, hs, hr]

theorem append_changed_payload_denied (a : Access) (s : PhaseState) (r : PhaseRequest)
    (receipt : Receipt) (ha : canWrite a = true)
    (hs : receiptFor s r = some receipt) (hr : receipt.request ≠ r) :
    append a s r = denied s := by
  simp [append, ha, hs, hr]

theorem append_stale_revision (a : Access) (s : PhaseState) (r : PhaseRequest)
    (ha : canWrite a = true) (hs : receiptFor s r = none)
    (hr : r.revision ≠ s.revision) : append a s r = denied s := by
  simp [append, ha, hs, hr]

theorem append_not_ready (a : Access) (s : PhaseState) (r : PhaseRequest)
    (ha : canWrite a = true) (hs : receiptFor s r = none)
    (hr : s.ready = false) : append a s r = denied s := by
  simp [append, ha, hs, hr]

theorem append_success (a : Access) (s : PhaseState) (r : PhaseRequest)
    (ha : canWrite a = true) (hs : receiptFor s r = none)
    (hr : r.revision = s.revision) (hready : s.ready = true) :
    append a s r = ⟨true, true, s.currentPhase + 1, s.revision + 1, commit s r⟩ := by
  simp [append, ha, hs, hr, hready]

theorem append_rejected_unchanged (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : (append a s r).accepted = false) : (append a s r).state = s := by
  by_cases ha : canWrite a = true
  · cases hs : receiptFor s r with
    | some receipt =>
        by_cases hr : receipt.request = r <;> simp [append, ha, hs, hr, denied]
    | none =>
        by_cases hg : s.ready = true ∧ r.revision = s.revision
        · simp [append, ha, hs, hg] at h
        · simp only [append, ha, hs, hg, ↓reduceIte, denied]
  · simp [append, ha, denied]

theorem commit_revision (s : PhaseState) (r : PhaseRequest) :
    (commit s r).revision = s.revision + 1 := by rfl

theorem commit_keeps_old_phase (s : PhaseState) (r : PhaseRequest) (n : Nat)
    (h : n ≤ s.currentPhase) : (commit s r).phases n = s.phases n := by
  have hn : n ≠ s.currentPhase + 1 := by omega
  simp [commit, hn]

theorem commit_new_phase (s : PhaseState) (r : PhaseRequest) :
    (commit s r).phases (s.currentPhase + 1) = some (r.replacement.getD s.latestData) := by
  simp [commit]

theorem commit_preserves_relations (s : PhaseState) (r : PhaseRequest) :
    (commit s r).relations = s.relations := by rfl

theorem commit_reason_once (s : PhaseState) (r : PhaseRequest) (reason : Nat)
    (h : r.reason = some reason) :
    (commit s r).comments = s.comments ++ [(s.currentPhase + 1, reason)] := by
  simp [commit, h]

theorem append_created_commit (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : (append a s r).created = true) : (append a s r).state = commit s r := by
  by_cases ha : canWrite a = true
  · cases hs : receiptFor s r with
    | some receipt =>
        by_cases hr : receipt.request = r <;> simp [append, ha, hs, hr, denied] at h
    | none =>
        by_cases hg : s.ready = true ∧ r.revision = s.revision
        · simp [append, ha, hs, hg]
        · simp only [append, ha, hs, hg, ↓reduceIte, denied] at h
          contradiction
  · simp [append, ha, denied] at h

theorem append_created_revision_phase (a : Access) (s : PhaseState) (r : PhaseRequest)
    (h : (append a s r).created = true) :
    (append a s r).state.revision = s.revision + 1 ∧
    (append a s r).state.currentPhase = s.currentPhase + 1 := by
  rw [append_created_commit a s r h]
  exact ⟨rfl, rfl⟩

theorem append_created_keeps_old_phase (a : Access) (s : PhaseState) (r : PhaseRequest)
    (n : Nat) (h : (append a s r).created = true) (hn : n ≤ s.currentPhase) :
    (append a s r).state.phases n = s.phases n := by
  rw [append_created_commit a s r h]
  exact commit_keeps_old_phase s r n hn

def permitted : Access := ⟨true, true, true⟩
def samplePayload : CreatePayload := ⟨1, 42, 0, [3], [4], true⟩
def sampleRequest : PhaseRequest := ⟨7, 9, 1, some 43, some 5⟩
def sampleState : PhaseState :=
  ⟨true, 1, 1, 42, fun n => if n = 1 then some 42 else none, [], [3, 4], []⟩

theorem create_success_reachable : (create permitted ⟨none⟩ samplePayload).created = true := by
  decide

theorem create_conflict_reachable :
    (create permitted ⟨some ⟨samplePayload, 1, 1, [42]⟩⟩
      { samplePayload with score := 99 }).accepted = false := by decide

theorem create_empty_relations_shape_conflict_reachable :
    let legacy : CreatePayload := ⟨1, 42, 0, [], [], false⟩
    create permitted ⟨some ⟨legacy, 1, 1, [42]⟩⟩
      { legacy with explicitRelations := true } =
        ⟨false, false, ⟨some ⟨legacy, 1, 1, [42]⟩⟩⟩ := by decide

theorem append_success_reachable : (append permitted sampleState sampleRequest).created = true := by
  decide

theorem append_stale_reachable :
    (append permitted sampleState { sampleRequest with revision := 0 }).accepted = false := by
  decide

end Verification.McpWrites
