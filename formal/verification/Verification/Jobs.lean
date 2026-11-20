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

end Verification.Jobs
