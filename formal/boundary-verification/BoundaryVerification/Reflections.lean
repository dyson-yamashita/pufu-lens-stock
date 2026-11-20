import BoundaryVerification.Auth

namespace BoundaryVerification.Reflections

def allowed (r : Auth.Request) (method : Auth.Method) (owner : Option Nat) (user : Nat) : Bool :=
  Auth.apiAllowed { r with method := method, route := .other } && (owner == some user)

inductive Status where
  | queued | ready | empty | failed
  deriving DecidableEq, Repr

structure Entry where
  generation : Nat
  status : Status
  text : Option Nat
  stocks : List Nat
  pufus : List Nat
  answer : Option Nat
  dismissed : Bool
  deriving DecidableEq, Repr

def read (r : Auth.Request) (owner : Option Nat) (user : Nat) (entry : Entry) : Option Entry :=
  if allowed r .get owner user && !entry.dismissed then some entry else none

theorem foreign_read_denied (r : Auth.Request) (owner : Option Nat) (user : Nat) (entry : Entry)
    (foreign : owner ≠ some user) : read r owner user entry = none := by
  simp [read, allowed, foreign]

theorem non_session_read_denied (r : Auth.Request) (owner : Option Nat) (user : Nat) (entry : Entry)
    (kind : r.kind = .anonymous ∨ r.kind = .token ∨ r.kind = .mcp) :
    read r owner user entry = none := by
  rcases kind with h | h | h <;>
    simp [read, allowed, Auth.apiAllowed, Auth.authenticated, Auth.routeAllowed,
      Auth.tokenRoute, Auth.mcpRoute, h]

structure RequestStore where
  selection : Option Nat
  jobs : Nat
  reserved : Nat
  deriving DecidableEq, Repr

inductive Acceptance where
  | replay | created | refused
  deriving DecidableEq, Repr

def request (r : Auth.Request) (owner : Option Nat) (user selection : Nat)
    (periodValid hasStock busy quotaAvailable : Bool) (before : RequestStore) :
    Acceptance × RequestStore :=
  if allowed r .post owner user && periodValid then
    match before.selection with
    | some prior => if prior == selection then (.replay, before) else (.refused, before)
    | none =>
      if hasStock && !busy && quotaAvailable then
        (.created, ⟨some selection, before.jobs + 1, before.reserved + 1⟩)
      else (.refused, before)
  else (.refused, before)

theorem replay_keeps_job_and_reservation (r : Auth.Request) (owner : Option Nat)
    (user selection : Nat) (periodValid hasStock busy quotaAvailable : Bool)
    (before : RequestStore) (same : before.selection = some selection) :
    (request r owner user selection periodValid hasStock busy quotaAvailable before).2 = before := by
  unfold request
  split <;> simp [same]

theorem quota_denial_keeps_request (r : Auth.Request) (owner : Option Nat)
    (user selection : Nat) (periodValid hasStock busy : Bool)
    (before : RequestStore) (new : before.selection = none) :
    request r owner user selection periodValid hasStock busy false before = (.refused, before) := by
  simp [request, new]

def answer (r : Auth.Request) (owner : Option Nat) (user generation value : Nat)
    (entry : Entry) : Entry :=
  if allowed r .patch owner user && (entry.generation == generation) && entry.text.isSome &&
      entry.answer.isNone && !entry.dismissed && (entry.status != .queued) then
    { entry with answer := some value, status := .ready }
  else entry

theorem stale_answer_denied (r : Auth.Request) (owner : Option Nat)
    (user generation value : Nat) (entry : Entry) (stale : entry.generation ≠ generation) :
    answer r owner user generation value entry = entry := by
  simp [answer, stale]

structure Weekly where
  autoEnabled : Bool
  onboarded : Bool
  alreadyScheduled : Bool
  unanswered : Bool
  generating : Bool
  eligibleStocks : Nat
  changedMaterials : Bool
  deriving DecidableEq, Repr

def schedule (s : Weekly) : Weekly :=
  if s.autoEnabled && s.onboarded && !s.alreadyScheduled && !s.unanswered && !s.generating &&
      (decide (3 ≤ s.eligibleStocks)) && s.changedMaterials then
    { s with alreadyScheduled := true, generating := true }
  else s

theorem existing_week_keeps_schedule (s : Weekly) (existing : s.alreadyScheduled = true) :
    schedule s = s := by
  simp [schedule, existing]

theorem unanswered_blocks_schedule (s : Weekly) (unanswered : s.unanswered = true) :
    schedule s = s := by
  simp [schedule, unanswered]

theorem fewer_than_three_cannot_schedule (s : Weekly) (sparse : s.eligibleStocks < 3) :
    schedule s = s := by
  have enough : ¬ 3 ≤ s.eligibleStocks := Nat.not_le_of_gt sparse
  simp [schedule, enough]

structure Candidate where
  text : Nat
  stocks : List Nat
  pufus : List Nat
  deriving DecidableEq, Repr

def adopt (entry : Entry) (candidate : Candidate) (stockRefsCurrent pufuRefsCurrent : Bool) : Entry :=
  if stockRefsCurrent && pufuRefsCurrent then
    { entry with
      status := .ready
      text := some candidate.text
      stocks := candidate.stocks
      pufus := candidate.pufus }
  else { entry with status := .empty }

def commit (owner : Option Nat) (jobUser generation : Nat)
    (running : Bool) (candidate : Option Candidate) (stockRefsCurrent pufuRefsCurrent : Bool)
    (before : Option Entry) : Option Entry :=
  match before with
  | none => none
  | some entry =>
    if (owner == some jobUser) && (entry.generation == generation) &&
        (entry.status == .queued) && running then
      some (match candidate with
        | some result => adopt entry result stockRefsCurrent pufuRefsCurrent
        | none => { entry with status := .empty })
    else before

theorem stale_commit_denied (owner : Option Nat) (jobUser generation : Nat) (running : Bool)
    (candidate : Option Candidate) (stockRefsCurrent pufuRefsCurrent : Bool) (entry : Entry)
    (stale : entry.generation ≠ generation) :
    commit owner jobUser generation running candidate stockRefsCurrent pufuRefsCurrent
      (some entry) = some entry := by
  simp [commit, stale]

theorem deleted_project_denies_commit (jobUser generation : Nat) (running : Bool)
    (candidate : Option Candidate) (stockRefsCurrent pufuRefsCurrent : Bool) (before : Option Entry) :
    commit none jobUser generation running candidate stockRefsCurrent pufuRefsCurrent before =
      before := by
  cases before <;> simp [commit]

theorem moved_stock_preserves_previous_question (entry : Entry) (candidate : Candidate)
    (pufuRefsCurrent : Bool) :
    adopt entry candidate false pufuRefsCurrent = { entry with status := .empty } := by
  simp [adopt]

def web : Auth.Request := ⟨.session, true, true, true, true, .post, .other⟩
def initial : Entry := ⟨1, .queued, none, [], [], none, false⟩
def generated : Entry := ⟨1, .ready, some 10, [20], [30], none, false⟩

theorem success_reachable :
    request web (some 1) 1 42 true true false true ⟨none, 0, 0⟩ =
      (.created, ⟨some 42, 1, 1⟩) ∧
    (schedule ⟨true, true, false, false, false, 3, true⟩).alreadyScheduled = true ∧
    commit (some 1) 1 1 true (some ⟨10, [20], [30]⟩) true true (some initial) = some generated ∧
    read web (some 1) 1 (answer web (some 1) 1 1 12 generated) =
      some { generated with answer := some 12 } := by
  decide

theorem rejection_reachable :
    request { web with sameOrigin := false } (some 1) 1 42 true true false true ⟨none, 0, 0⟩ =
      (.refused, ⟨none, 0, 0⟩) ∧
    request web (some 1) 1 43 true true false true ⟨some 42, 1, 1⟩ =
      (.refused, ⟨some 42, 1, 1⟩) ∧
    commit none 1 1 true (some ⟨10, [20], [30]⟩) true true none = none := by
  decide

end BoundaryVerification.Reflections
