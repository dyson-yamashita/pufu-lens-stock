import Std
import Lean
import BoundaryVerification.Auth

namespace BoundaryVerification.McpWrites

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

theorem append_late_replay_reachable :
    let saved := commit sampleState sampleRequest
    let later := { saved with revision := 10, currentPhase := 8, ready := false }
    (append permitted later sampleRequest).accepted = true ∧
    (append permitted later sampleRequest).created = false ∧
    (append permitted later sampleRequest).phase = 2 ∧
    (append permitted later sampleRequest).revision = 2 := by decide

-- The oracle serializes evaluations of the existing transition; it does not
-- implement a second append/commit algorithm. Opaque data/reason IDs are mapped
-- to concrete API payloads by the conformance test.
namespace Oracle

structure AccessJSON where
  authenticated : Bool
  writeScope : Bool
  ownsTarget : Bool
  projectAllowed : Bool
  deriving Lean.ToJson

structure PhaseJSON where
  number : Nat
  data : Nat
  deriving Lean.ToJson

structure CommentJSON where
  phase : Nat
  reason : Nat
  deriving Lean.ToJson

structure ReceiptJSON where
  requestId : Nat
  pufuId : Nat
  requestRevision : Nat
  replacement : Option Nat
  reason : Option Nat
  phase : Nat
  revision : Nat
  deriving Lean.ToJson

structure StateJSON where
  ready : Bool
  revision : Nat
  currentPhase : Nat
  latestData : Nat
  phases : List PhaseJSON
  comments : List CommentJSON
  relations : List Nat
  receipts : List ReceiptJSON
  deriving Lean.ToJson

instance : Lean.ToJson PhaseRequest where
  toJson r := Lean.Json.mkObj [
    ("requestId", Lean.toJson r.requestId),
    ("pufuId", Lean.toJson r.pufuId),
    ("revision", Lean.toJson r.revision),
    ("replacement", Lean.toJson r.replacement),
    ("reason", Lean.toJson r.reason)]

structure ExpectedJSON where
  status : Nat
  accepted : Bool
  created : Bool
  phase : Nat
  revision : Nat
  state : StateJSON
  deriving Lean.ToJson

structure StepJSON where
  access : AccessJSON
  request : PhaseRequest
  expected : ExpectedJSON
  deriving Lean.ToJson

structure CaseJSON where
  id : String
  initial : StateJSON
  steps : List StepJSON
  deriving Lean.ToJson

structure FixtureJSON where
  version : Nat
  cases : List CaseJSON
  deriving Lean.ToJson

def normalizeState (s : PhaseState) : StateJSON :=
  { ready := s.ready
    revision := s.revision
    currentPhase := s.currentPhase
    latestData := s.latestData
    phases := (List.range (s.currentPhase + 1)).filterMap fun number =>
      (s.phases number).map fun data => ⟨number, data⟩
    comments := s.comments.map fun (phase, reason) => ⟨phase, reason⟩
    relations := s.relations
    receipts := (s.receipts.mergeSort fun a b =>
      a.request.requestId <= b.request.requestId).map fun receipt =>
        ⟨receipt.request.requestId, receipt.request.pufuId, receipt.request.revision,
          receipt.request.replacement, receipt.request.reason, receipt.phase, receipt.revision⟩ }

-- The input bit abstracts provider verification. The existing Auth model sees
-- a verified MCP principal or an anonymous principal at the MCP entrance.
def entranceRequest (a : AccessJSON) : BoundaryVerification.Auth.Request :=
  ⟨if a.authenticated then .mcp else .anonymous,
    true, true, true, true, .post, .pufus⟩

def run (a : AccessJSON) (s : PhaseState) (r : PhaseRequest) : PhaseResult :=
  if BoundaryVerification.Auth.mcpEntrance (entranceRequest a) then
    append ⟨a.writeScope, a.ownsTarget, a.projectAllowed⟩ s r
  else denied s

-- HTTP status is an adapter to the implementation's observable error classes:
-- entrance 401, scope 403, hidden owner/project 404, transition conflict 409.
-- Acceptance and every post-state still come exclusively from Auth/append.
def status (a : AccessJSON) (result : PhaseResult) : Nat :=
  if !BoundaryVerification.Auth.mcpEntrance (entranceRequest a) then 401
  else if !a.writeScope then 403
  else if !a.ownsTarget || !a.projectAllowed then 404
  else if result.accepted then 200
  else 409

def normalizeResult (a : AccessJSON) (result : PhaseResult) : ExpectedJSON :=
  ⟨status a result, result.accepted, result.created, result.phase, result.revision,
    normalizeState result.state⟩

def steps (s : PhaseState) : List (AccessJSON × PhaseRequest) → List StepJSON
  | [] => []
  | (a, r) :: rest =>
      let result := run a s r
      ⟨a, r, normalizeResult a result⟩ :: steps result.state rest

def scenario (id : String) (initial : PhaseState)
    (inputs : List (AccessJSON × PhaseRequest)) : CaseJSON :=
  ⟨id, normalizeState initial, steps initial inputs⟩

def allowed : AccessJSON := ⟨true, true, true, true⟩

def initial : PhaseState :=
  ⟨true, 1, 1, 1, fun n => if n = 1 then some 1 else none, [], [1, 2], []⟩

def copyRequest : PhaseRequest := ⟨1, 1, 1, none, none⟩
def replaceRequest : PhaseRequest := ⟨1, 1, 1, some 2, some 7⟩

def cases : List CaseJSON := [
  scenario "unauthenticated" initial
    [({ allowed with authenticated := false }, replaceRequest)],
  scenario "scope-denied" initial
    [({ allowed with writeScope := false }, replaceRequest)],
  scenario "owner-denied" initial
    [({ allowed with ownsTarget := false }, replaceRequest)],
  scenario "project-denied" initial
    [({ allowed with projectAllowed := false }, replaceRequest)],
  scenario "not-ready" { initial with ready := false }
    [(allowed, replaceRequest)],
  scenario "stale-revision" { initial with revision := 2 }
    [(allowed, replaceRequest)],
  scenario "copy" initial [(allowed, copyRequest)],
  scenario "replace-and-reason" initial [(allowed, replaceRequest)],
  scenario "replay" initial [(allowed, replaceRequest), (allowed, replaceRequest)],
  scenario "late-replay" initial [
    (allowed, replaceRequest),
    (allowed, ⟨2, 1, 2, some 3, some 8⟩),
    (allowed, replaceRequest)],
  scenario "changed-payload" initial [
    (allowed, replaceRequest),
    (allowed, { replaceRequest with replacement := some 3 })],
  scenario "changed-reason" initial [
    (allowed, replaceRequest),
    (allowed, { replaceRequest with reason := some 8 })],
  scenario "changed-revision" initial [
    (allowed, replaceRequest),
    (allowed, { replaceRequest with revision := 2 })],
  scenario "scope-denied-replay" initial [
    (allowed, replaceRequest),
    ({ allowed with writeScope := false }, replaceRequest)],
  scenario "project-denied-replay" initial [
    (allowed, replaceRequest),
    ({ allowed with projectAllowed := false }, replaceRequest)],
  scenario "owner-denied-replay" initial [
    (allowed, replaceRequest),
    ({ allowed with ownsTarget := false }, replaceRequest)] ]

def fixture : FixtureJSON := ⟨1, cases⟩
def json : String := (Lean.toJson fixture).compress

theorem success_reachable :
    (run allowed initial replaceRequest).created = true ∧
    (run allowed initial replaceRequest).phase = 2 ∧
    (run allowed initial replaceRequest).revision = 2 := by decide

theorem entrance_denial_reachable :
    let result := run { allowed with authenticated := false } initial replaceRequest
    result.accepted = false ∧ normalizeState result.state = normalizeState initial := by
  simp [run, entranceRequest, BoundaryVerification.Auth.mcpEntrance, denied]

end Oracle

end BoundaryVerification.McpWrites
