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
  if allowed r .get owner user && !entry.dismissed && entry.text.isSome then some entry else none

theorem foreign_read_denied (r : Auth.Request) (owner : Option Nat) (user : Nat) (entry : Entry)
    (foreign : owner ≠ some user) : read r owner user entry = none := by
  simp [read, allowed, foreign]

theorem non_session_read_denied (r : Auth.Request) (owner : Option Nat) (user : Nat) (entry : Entry)
    (kind : r.kind = .anonymous ∨ r.kind = .token ∨ r.kind = .mcp) :
    read r owner user entry = none := by
  rcases kind with h | h | h <;>
    simp [read, allowed, Auth.apiAllowed, Auth.authenticated, Auth.routeAllowed,
      Auth.tokenRoute, Auth.mcpRoute, h]

inductive Period where
  | weekly | biweekly | monthly
  deriving DecidableEq, Repr

def configurePeriod (r : Auth.Request) (owner : Option Nat) (user : Nat)
    (current proposed : Period) : Period :=
  if allowed r .patch owner user then proposed else current

theorem foreign_period_update_denied (r : Auth.Request) (owner : Option Nat)
    (user : Nat) (current proposed : Period) (foreign : owner ≠ some user) :
    configurePeriod r owner user current proposed = current := by
  simp [configurePeriod, allowed, foreign]

structure Regeneration where
  entry : Entry
  jobs : Nat
  reserved : Nat
  deriving DecidableEq, Repr

def regenerate (r : Auth.Request) (owner : Option Nat) (user generation : Nat)
    (retry busy quotaAvailable : Bool) (before : Regeneration) : Regeneration :=
  let entry := before.entry
  if allowed r .patch owner user && (entry.generation == generation) && entry.text.isSome &&
      entry.answer.isNone && !entry.dismissed && (entry.status == (if retry then .failed else .ready)) &&
      !busy && quotaAvailable then
    ⟨{ entry with generation := generation + 1, status := .queued },
      before.jobs + 1, before.reserved + 1⟩
  else before

theorem quota_denial_preserves_regeneration (r : Auth.Request) (owner : Option Nat)
    (user generation : Nat) (retry busy : Bool) (before : Regeneration) :
    regenerate r owner user generation retry busy false before = before := by
  simp [regenerate]

theorem stale_regeneration_denied (r : Auth.Request) (owner : Option Nat) (user generation : Nat)
    (retry busy quotaAvailable : Bool) (before : Regeneration)
    (stale : before.entry.generation ≠ generation) :
    regenerate r owner user generation retry busy quotaAvailable before = before := by
  simp [regenerate, stale]

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

structure Schedule where
  autoEnabled : Bool
  onboarded : Bool
  latestEnd : Nat
  unanswered : Bool
  generating : Bool
  eligibleStocks : Nat
  changedMaterials : Bool
  deriving DecidableEq, Repr

def schedule (s : Schedule) (cutoff : Nat) : Schedule :=
  if s.autoEnabled && s.onboarded && decide (s.latestEnd < cutoff) && !s.unanswered && !s.generating &&
      (decide (3 ≤ s.eligibleStocks)) && s.changedMaterials then
    { s with latestEnd := cutoff, generating := true }
  else s

theorem closed_period_keeps_schedule (s : Schedule) (cutoff : Nat)
    (closed : cutoff ≤ s.latestEnd) : schedule s cutoff = s := by
  simp [schedule, Nat.not_lt_of_ge closed]

theorem disabled_blocks_schedule (s : Schedule) (cutoff : Nat) (off : s.autoEnabled = false) :
    schedule s cutoff = s := by
  simp [schedule, off]

theorem unanswered_blocks_schedule (s : Schedule) (cutoff : Nat) (unanswered : s.unanswered = true) :
    schedule s cutoff = s := by
  simp [schedule, unanswered]

theorem fewer_than_three_cannot_schedule (s : Schedule) (cutoff : Nat)
    (sparse : s.eligibleStocks < 3) : schedule s cutoff = s := by
  have enough : ¬ 3 ≤ s.eligibleStocks := Nat.not_le_of_gt sparse
  simp [schedule, enough]

def mayStartAutomatic (enabled : Bool) (reservedEnd currentCutoff : Nat) : Bool :=
  enabled && (reservedEnd == currentCutoff)

theorem mismatched_cutoff_cancels (enabled : Bool) (reservedEnd currentCutoff : Nat)
    (mismatch : reservedEnd ≠ currentCutoff) :
    mayStartAutomatic enabled reservedEnd currentCutoff = false := by
  simp [mayStartAutomatic, mismatch]

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

def web : Auth.Request := ⟨.session, true, true, true, true, .patch, .other⟩
def initial : Entry := ⟨1, .queued, none, [], [], none, false⟩
def generated : Entry := ⟨1, .ready, some 10, [20], [30], none, false⟩

theorem success_reachable :
    configurePeriod web (some 1) 1 .weekly .monthly = .monthly ∧
    (schedule ⟨true, true, 7, false, false, 3, true⟩ 14).latestEnd = 14 ∧
    mayStartAutomatic true 14 14 = true ∧
    commit (some 1) 1 1 true (some ⟨10, [20], [30]⟩) true true (some initial) = some generated ∧
    regenerate web (some 1) 1 1 false false true ⟨generated, 0, 0⟩ =
      ⟨{ generated with status := .queued, generation := 2 }, 1, 1⟩ ∧
    read web (some 1) 1 (answer web (some 1) 1 1 12 generated) =
      some { generated with answer := some 12 } := by
  decide

theorem rejection_reachable :
    configurePeriod { web with sameOrigin := false } (some 1) 1 .weekly .monthly = .weekly ∧
    (schedule ⟨true, true, 14, false, false, 3, true⟩ 7).latestEnd = 14 ∧
    mayStartAutomatic true 14 7 = false ∧
    regenerate web (some 1) 1 1 false false true ⟨initial, 0, 0⟩ = ⟨initial, 0, 0⟩ ∧
    commit none 1 1 true (some ⟨10, [20], [30]⟩) true true none = none := by
  decide

end BoundaryVerification.Reflections
