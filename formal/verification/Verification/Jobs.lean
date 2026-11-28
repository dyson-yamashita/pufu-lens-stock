import Std

namespace Verification.Jobs

/- Only the D1 memory/source commit is atomic here. The preceding R2 PUT is not. -/
structure Owner where
  present : Bool
  belongsToUser : Bool
  revision : Nat
  deriving DecidableEq, Repr

structure Memory where
  revision : Nat
  text : Nat
  sources : List Nat
  deriving DecidableEq, Repr

def mayCommitMemory (owner : Owner) (revision : Nat) : Prop :=
  owner.present = true ∧ owner.belongsToUser = true ∧ owner.revision = revision

instance (owner : Owner) (revision : Nat) : Decidable (mayCommitMemory owner revision) :=
  by unfold mayCommitMemory; infer_instance

def commitMemory (owner : Owner) (revision text : Nat) (sources : List Nat)
    (before : Memory) : Memory :=
  if mayCommitMemory owner revision then ⟨revision, text, sources⟩ else before

theorem current_generation_commits (owner : Owner) (revision text : Nat)
    (sources : List Nat) (before : Memory) (alive : owner.present = true)
    (owned : owner.belongsToUser = true) (current : owner.revision = revision) :
    commitMemory owner revision text sources before = ⟨revision, text, sources⟩ := by
  simp [commitMemory, mayCommitMemory, alive, owned, current]

theorem stale_generation_preserves_memory (owner : Owner) (revision text : Nat)
    (sources : List Nat) (before : Memory) (stale : owner.revision ≠ revision) :
    commitMemory owner revision text sources before = before := by
  simp [commitMemory, mayCommitMemory, stale]

theorem deleted_owner_preserves_memory (owner : Owner) (revision text : Nat)
    (sources : List Nat) (before : Memory) (deleted : owner.present = false) :
    commitMemory owner revision text sources before = before := by
  simp [commitMemory, mayCommitMemory, deleted]

theorem foreign_owner_preserves_memory (owner : Owner) (revision text : Nat)
    (sources : List Nat) (before : Memory) (foreign : owner.belongsToUser = false) :
    commitMemory owner revision text sources before = before := by
  simp [commitMemory, mayCommitMemory, foreign]

inductive Status where
  | pending | dispatched | running | done | failed
  deriving DecidableEq, Repr

structure Job where
  status : Status
  attempts : Nat
  updatedAt : Nat
  deferred : Bool
  deriving DecidableEq, Repr

structure Lease where
  status : Status
  attempts : Nat
  updatedAt : Nat
  deriving DecidableEq, Repr

/- scheduledMaintenance supplies all three optional SQL guards. Other callers may not. -/
def leaseMatches (job : Job) (lease : Lease) : Prop :=
  job.status = lease.status ∧ job.attempts = lease.attempts ∧ job.updatedAt = lease.updatedAt

instance (job : Job) (lease : Lease) : Decidable (leaseMatches job lease) :=
  by unfold leaseMatches; infer_instance

def deferWithLease (job : Job) (lease : Lease) (now : Nat) : Job :=
  if job.status ≠ .done ∧ job.status ≠ .failed ∧ leaseMatches job lease then
    { job with status := .pending, updatedAt := now, deferred := true }
  else job

theorem stale_timestamp_preserves_job (job : Job) (lease : Lease) (now : Nat)
    (stale : job.updatedAt ≠ lease.updatedAt) : deferWithLease job lease now = job := by
  simp [deferWithLease, leaseMatches, stale]

theorem stale_attempt_preserves_job (job : Job) (lease : Lease) (now : Nat)
    (stale : job.attempts ≠ lease.attempts) : deferWithLease job lease now = job := by
  simp [deferWithLease, leaseMatches, stale]

theorem terminal_job_preserved (job : Job) (lease : Lease) (now : Nat)
    (terminal : job.status = .done ∨ job.status = .failed) :
    deferWithLease job lease now = job := by
  rcases terminal with terminal | terminal <;> simp [deferWithLease, terminal]

/- These are dispatcher UPDATE-time facts, rather than a guarantee about later steps. -/
structure DispatchFacts where
  cleanup : Bool
  userExists : Bool
  onboarded : Bool
  questionEnabled : Bool
  withinWaitLimit : Bool
  deriving DecidableEq, Repr

def mayDispatch (job : Job) (facts : DispatchFacts) : Prop :=
  job.status = .pending ∧
  (facts.cleanup = true ∨ (facts.userExists = true ∧ facts.onboarded = true)) ∧
  facts.questionEnabled = true ∧ job.attempts < 10 ∧
  facts.withinWaitLimit = true ∧ job.deferred = false

instance (job : Job) (facts : DispatchFacts) : Decidable (mayDispatch job facts) :=
  inferInstanceAs (Decidable (_ ∧ _ ∧ _ ∧ _ ∧ _ ∧ _))

def claimDispatch (job : Job) (facts : DispatchFacts) (now : Nat) : Job :=
  if mayDispatch job facts then
    { job with status := .dispatched, attempts := job.attempts + 1, updatedAt := now }
  else job

theorem deleted_user_cannot_dispatch (job : Job) (facts : DispatchFacts) (now : Nat)
    (ordinary : facts.cleanup = false) (deleted : facts.userExists = false) :
    claimDispatch job facts now = job := by
  simp [claimDispatch, mayDispatch, ordinary, deleted]

def claimWorkflow (job : Job) (now : Nat) : Job :=
  if job.status ≠ .done ∧ job.status ≠ .failed then
    { job with status := .running, updatedAt := now }
  else job

theorem stopped_workflow_cannot_restart (job : Job) (now : Nat)
    (terminal : job.status = .done ∨ job.status = .failed) :
    claimWorkflow job now = job := by
  rcases terminal with terminal | terminal <;> simp [claimWorkflow, terminal]

structure ArticleState where
  generation : Option Nat
  belongsToUser : Bool
  ready : Bool
  summary : Option Nat
  memoryRevision : Nat
  questionQueued : Bool
  deriving DecidableEq, Repr

-- The generation is shared by the summary and its dependent D1 writes.
def completeArticle (s : ArticleState) (generation summary : Nat) (autoQuestion : Bool) :
    ArticleState :=
  if (s.generation == some generation) && s.belongsToUser then
    let updated :=
      if s.ready then s
      else { s with ready := true, summary := some summary, memoryRevision := s.memoryRevision + 1 }
    { updated with questionQueued := s.questionQueued || autoQuestion }
  else s

theorem old_article_cannot_commit (s : ArticleState) (generation summary : Nat) (autoQuestion : Bool)
    (stale : s.generation ≠ some generation) :
    completeArticle s generation summary autoQuestion = s := by
  simp [completeArticle, stale]

theorem article_summary_replay_does_not_advance_memory (s : ArticleState)
    (generation summary : Nat) (autoQuestion : Bool) (ready : s.ready = true) :
    (completeArticle s generation summary autoQuestion).memoryRevision = s.memoryRevision := by
  rcases s with ⟨current, owned, readyFlag, stored, revision, queued⟩
  cases readyFlag
  · contradiction
  · simp [completeArticle] <;> split <;> rfl

theorem article_completion_reachable :
    completeArticle ⟨some 2, true, false, none, 3, false⟩ 2 42 true =
      ⟨some 2, true, true, some 42, 4, true⟩ := by decide

theorem article_rejection_reachable :
    completeArticle ⟨some 3, true, false, none, 3, false⟩ 2 42 true =
      ⟨some 3, true, false, none, 3, false⟩ := by decide

structure RetrievedBody where
  article : ArticleState
  urlSource : Bool
  hasInputText : Bool
  extracting : Bool
  shortTextLength : Option Nat
  deriving DecidableEq, Repr

def retainShortText (s : RetrievedBody) (generation length : Nat) (running : Bool) : RetrievedBody :=
  if (s.article.generation == some generation) && s.article.belongsToUser &&
      s.urlSource && !s.hasInputText && s.extracting && running && decide (0 < length ∧ length < 200) then
    { s with shortTextLength := some length }
  else s

theorem stale_short_text_denied (s : RetrievedBody) (generation length : Nat) (running : Bool)
    (stale : s.article.generation ≠ some generation) :
    retainShortText s generation length running = s := by
  simp [retainShortText, stale]

theorem foreign_short_text_denied (s : RetrievedBody) (generation length : Nat) (running : Bool)
    (foreign : s.article.belongsToUser = false) :
    retainShortText s generation length running = s := by
  simp [retainShortText, foreign]

theorem stopped_short_text_denied (s : RetrievedBody) (generation length : Nat) :
    retainShortText s generation length false = s := by
  simp [retainShortText]

theorem non_extraction_short_text_denied (s : RetrievedBody) (generation length : Nat) (running : Bool)
    (denied : s.urlSource = false ∨ s.hasInputText = true ∨ s.extracting = false) :
    retainShortText s generation length running = s := by
  rcases denied with h | h | h <;> simp [retainShortText, h]

theorem out_of_range_short_text_denied (s : RetrievedBody) (generation length : Nat) (running : Bool)
    (denied : ¬ (0 < length ∧ length < 200)) :
    retainShortText s generation length running = s := by
  simp [retainShortText, denied]

theorem short_text_preserves_article_state (s : RetrievedBody) (generation length : Nat) (running : Bool) :
    (retainShortText s generation length running).article = s.article ∧
      (retainShortText s generation length running).extracting = s.extracting := by
  unfold retainShortText
  split <;> simp

theorem short_text_decisions_reachable :
    let s : RetrievedBody := ⟨⟨some 3, true, false, none, 0, false⟩, true, false, true, none⟩
    (retainShortText s 3 199 true).shortTextLength = some 199 ∧
      retainShortText s 2 199 true = s ∧ retainShortText s 3 200 true = s := by decide

-- Restricted to jobs whose target has a source revision (article generation here).
def retireSuperseded (job : Job) (revision : Nat) (current : Option Nat) (now : Nat) : Job :=
  if job.status == .pending && (current.any (fun actual => decide (revision < actual))) then
    { job with status := .done, updatedAt := now }
  else job

theorem running_job_is_not_retired (job : Job) (revision current now : Nat)
    (running : job.status = .running) :
    retireSuperseded job revision (some current) now = job := by
  simp [retireSuperseded, running]

theorem current_job_is_not_retired (job : Job) (revision now : Nat) :
    retireSuperseded job revision (some revision) now = job := by
  simp [retireSuperseded]

theorem retirement_reachable :
    (retireSuperseded ⟨.pending, 0, 1, false⟩ 2 (some 3) 4).status = .done := by decide

theorem memory_success_reachable :
    commitMemory ⟨true, true, 2⟩ 2 20 [7] ⟨1, 10, [3]⟩ = ⟨2, 20, [7]⟩ := by
  decide

theorem memory_rejection_reachable :
    commitMemory ⟨true, true, 3⟩ 2 20 [7] ⟨1, 10, [3]⟩ = ⟨1, 10, [3]⟩ := by
  decide

theorem lease_success_reachable :
    deferWithLease ⟨.running, 1, 10, false⟩ ⟨.running, 1, 10⟩ 20 =
      ⟨.pending, 1, 20, true⟩ := by
  decide

theorem lease_rejection_reachable :
    deferWithLease ⟨.running, 1, 11, false⟩ ⟨.running, 1, 10⟩ 20 =
      ⟨.running, 1, 11, false⟩ := by
  decide

theorem dispatch_success_reachable :
    claimDispatch ⟨.pending, 0, 1, false⟩ ⟨false, true, true, true, true⟩ 2 =
      ⟨.dispatched, 1, 2, false⟩ := by
  decide

theorem cleanup_without_user_reachable :
    claimDispatch ⟨.pending, 0, 1, false⟩ ⟨true, false, false, true, true⟩ 2 =
      ⟨.dispatched, 1, 2, false⟩ := by
  decide

theorem dispatch_rejection_reachable :
    claimDispatch ⟨.pending, 0, 1, false⟩ ⟨false, false, true, true, true⟩ 2 =
      ⟨.pending, 0, 1, false⟩ := by
  decide

namespace Reanalysis

structure Facts where
  owner : Bool
  memoryUpdates : Bool
  hasDetails : Bool
  sourcesCurrent : Bool
  deriving DecidableEq, Repr

structure State where
  original : Nat
  period : Nat
  history : Nat
  approvedCopy : Nat
  generation : Nat
  jobId : Nat
  pending : Bool
  result : Option Nat
  deriving DecidableEq, Repr

def eligible (facts : Facts) : Bool :=
  facts.owner && facts.memoryUpdates && facts.hasDetails && facts.sourcesCurrent

def enqueue (facts : Facts) (session sameOrigin historyAvailable : Bool)
    (expected newJob : Nat) (s : State) : State :=
  if (eligible facts && session && sameOrigin && historyAvailable && !s.pending) &&
      s.generation == expected then
    { s with jobId := newJob, generation := s.generation + 1, pending := true }
  else s

def mayAnalyze (facts : Facts) (running inputsCurrent : Bool) (jobId : Nat) (s : State) : Bool :=
  eligible facts && running && inputsCurrent && s.pending && s.jobId == jobId

def save (facts : Facts) (running inputsCurrent : Bool) (jobId output : Nat) (s : State) : State :=
  if mayAnalyze facts running inputsCurrent jobId s then
    { s with result := some output, pending := false }
  else s

def revoke (s : State) : State := { s with pending := false }

theorem off_then_on_cannot_commit (facts : Facts) (running inputsCurrent : Bool)
    (jobId output : Nat) (s : State) :
    save facts running inputsCurrent jobId output (revoke s) = revoke s := by
  simp [save, mayAnalyze, revoke]

theorem enqueue_requires_current_generation (facts : Facts) (session origin historyAvailable : Bool)
    (expected newJob : Nat) (s : State) (h : s.generation ≠ expected) :
    enqueue facts session origin historyAvailable expected newJob s = s := by
  simp [enqueue, h]

theorem enqueue_requires_no_active_job (facts : Facts) (session origin historyAvailable : Bool)
    (expected newJob : Nat) (s : State) (h : s.pending = true) :
    enqueue facts session origin historyAvailable expected newJob s = s := by
  simp [enqueue, h]

theorem nonowner_cannot_enqueue (facts : Facts) (session origin historyAvailable : Bool)
    (expected newJob : Nat) (s : State) (h : facts.owner = false) :
    enqueue facts session origin historyAvailable expected newJob s = s := by
  simp [enqueue, eligible, h]

theorem stale_job_preserves_result (facts : Facts) (running inputsCurrent : Bool)
    (jobId output : Nat) (s : State) (h : s.jobId ≠ jobId) :
    save facts running inputsCurrent jobId output s = s := by
  simp [save, mayAnalyze, h]

theorem revoked_memory_rejects_analysis (facts : Facts) (running inputsCurrent : Bool)
    (jobId output : Nat) (s : State) (h : facts.memoryUpdates = false) :
    mayAnalyze facts running inputsCurrent jobId s = false ∧
      save facts running inputsCurrent jobId output s = s := by
  simp [save, mayAnalyze, eligible, h]

theorem removed_input_preserves_result (facts : Facts) (running : Bool)
    (jobId output : Nat) (s : State) : save facts running false jobId output s = s := by
  simp [save, mayAnalyze]

theorem protected_fields_preserved (facts : Facts) (running inputsCurrent : Bool)
    (jobId output : Nat) (s : State) :
    let next := save facts running inputsCurrent jobId output s
    next.original = s.original ∧ next.period = s.period ∧ next.history = s.history ∧
      next.approvedCopy = s.approvedCopy := by
  simp only [save]
  split <;> simp

def initialState : State := ⟨10, 11, 12, 13, 0, 0, false, none⟩
def allowed : Facts := ⟨true, true, true, true⟩

theorem enqueue_and_save_reachable :
    let queued := enqueue allowed true true true 0 8 initialState
    queued.pending = true ∧ (save allowed true true 8 20 queued).result = some 20 := by decide

theorem continuing_is_rejected :
    enqueue { allowed with hasDetails := false } true true true 0 8 initialState = initialState := by decide

end Reanalysis

end Verification.Jobs
