import Std

namespace BoundaryVerification.Deletion

/- One user's slice. External objects are deliberately not part of the D1 cascade. -/
structure Account where
  userExists : Bool
  logicalRows : Nat
  authenticated : Bool
  jobs : List Nat
  tombstone : Option Nat
  pendingJobs : List Nat
  externalObject : Bool
  otherUserRows : Nat
  deriving DecidableEq, Repr

def requestDeletion (state : Account) (generation : Nat) : Account :=
  { state with
    userExists := false
    logicalRows := 0
    authenticated := false
    pendingJobs := state.pendingJobs ++ state.jobs
    jobs := []
    tombstone := if state.userExists then state.tombstone.or (some generation) else state.tombstone }

theorem deletion_cascades_logical_data (state : Account) (generation : Nat) :
    (requestDeletion state generation).userExists = false ∧
    (requestDeletion state generation).logicalRows = 0 ∧
    (requestDeletion state generation).authenticated = false ∧
    (requestDeletion state generation).jobs = [] := by
  simp [requestDeletion]

theorem deletion_preserves_cleanup_work (state : Account) (generation : Nat) :
    (requestDeletion state generation).pendingJobs = state.pendingJobs ++ state.jobs := by
  rfl

theorem deletion_does_not_claim_external_atomicity (state : Account) (generation : Nat) :
    (requestDeletion state generation).externalObject = state.externalObject ∧
    (requestDeletion state generation).otherUserRows = state.otherUserRows := by
  exact ⟨rfl, rfl⟩

structure Sweep where
  contentComplete : Bool
  historyComplete : Bool
  oauthComplete : Bool
  deriving DecidableEq, Repr

/- Called after external deletes/revocations. Failure or a partial page cannot finish. -/
def mayFinish (state : Account) (observedGeneration : Nat) (sweep : Sweep) : Prop :=
  state.tombstone = some observedGeneration ∧ state.pendingJobs = [] ∧
  sweep.contentComplete = true ∧ sweep.historyComplete = true ∧ sweep.oauthComplete = true

instance (state : Account) (generation : Nat) (sweep : Sweep) :
    Decidable (mayFinish state generation sweep) :=
  by unfold mayFinish; infer_instance

def finishCleanup (state : Account) (observedGeneration : Nat) (sweep : Sweep) : Account :=
  if mayFinish state observedGeneration sweep then { state with tombstone := none } else state

theorem matching_complete_cleanup_finishes (state : Account) (observedGeneration : Nat)
    (sweep : Sweep) (current : state.tombstone = some observedGeneration)
    (jobsDone : state.pendingJobs = []) (contentDone : sweep.contentComplete = true)
    (historyDone : sweep.historyComplete = true) (oauthDone : sweep.oauthComplete = true) :
    (finishCleanup state observedGeneration sweep).tombstone = none := by
  simp [finishCleanup, mayFinish, current, jobsDone, contentDone, historyDone, oauthDone]

theorem stale_cleanup_preserves_request (state : Account) (observedGeneration : Nat)
    (sweep : Sweep) (stale : state.tombstone ≠ some observedGeneration) :
    finishCleanup state observedGeneration sweep = state := by
  simp [finishCleanup, mayFinish, stale]

theorem unfinished_jobs_preserve_request (state : Account) (observedGeneration : Nat)
    (sweep : Sweep) (pending : state.pendingJobs ≠ []) :
    finishCleanup state observedGeneration sweep = state := by
  simp [finishCleanup, mayFinish, pending]

theorem partial_sweep_preserves_request (state : Account) (observedGeneration : Nat)
    (sweep : Sweep) (incomplete : sweep.contentComplete = false ∨
      sweep.historyComplete = false ∨ sweep.oauthComplete = false) :
    finishCleanup state observedGeneration sweep = state := by
  rcases incomplete with h | h | h <;> simp [finishCleanup, mayFinish, h]

/- A post-I/O account absence check rotates/recreates the tombstone before retrying. -/
def observeLateWrite (state : Account) (freshGeneration : Nat) : Account :=
  if state.userExists then state else { state with tombstone := some freshGeneration }

theorem late_write_recreates_request (state : Account) (freshGeneration : Nat)
    (deleted : state.userExists = false) :
    (observeLateWrite state freshGeneration).tombstone = some freshGeneration := by
  simp [observeLateWrite, deleted]

theorem old_sweep_cannot_acknowledge_late_write (state : Account) (observed fresh : Nat)
    (sweep : Sweep) (deleted : state.userExists = false) (distinct : fresh ≠ observed) :
    finishCleanup (observeLateWrite state fresh) observed sweep = observeLateWrite state fresh := by
  apply stale_cleanup_preserves_request
  simp [observeLateWrite, deleted, distinct]

/- memory_history_cleanup uses its own prefix generation with the same final check. -/
def finishPrefixCleanup (pending : Option Nat) (observed : Nat) (truncated : Bool) : Option Nat :=
  if truncated = false ∧ pending = some observed then none else pending

theorem stale_prefix_cleanup_preserves_request (pending : Option Nat) (observed : Nat)
    (truncated : Bool) (stale : pending ≠ some observed) :
    finishPrefixCleanup pending observed truncated = pending := by
  simp [finishPrefixCleanup, stale]

/- Interrupted R2 PUT intents survive cascades and every retry; a later PUT is allowed. -/
structure HistoryWrite where
  ownerExists : Bool
  unresolvedIntent : Bool
  externalObject : Bool
  deriving DecidableEq, Repr

def retryInterruptedWrite (state : HistoryWrite) : HistoryWrite :=
  if state.ownerExists = false ∧ state.unresolvedIntent = true then
    { state with externalObject := false }
  else state

def lateProviderPut (state : HistoryWrite) : HistoryWrite :=
  { state with externalObject := true }

theorem interrupted_intent_is_retained (state : HistoryWrite) :
    (retryInterruptedWrite state).unresolvedIntent = state.unresolvedIntent := by
  simp only [retryInterruptedWrite]
  split <;> rfl

theorem late_provider_put_is_recleaned (state : HistoryWrite)
    (deleted : state.ownerExists = false) (unresolved : state.unresolvedIntent = true) :
    (retryInterruptedWrite (lateProviderPut (retryInterruptedWrite state))).externalObject = false ∧
    (retryInterruptedWrite (lateProviderPut (retryInterruptedWrite state))).unresolvedIntent = true := by
  simp [retryInterruptedWrite, lateProviderPut, deleted, unresolved]

theorem deletion_success_reachable :
    requestDeletion ⟨true, 9, true, [1], none, [], true, 4⟩ 10 =
      ⟨false, 0, false, [], some 10, [1], true, 4⟩ := by
  decide

theorem cleanup_success_reachable :
    finishCleanup ⟨false, 0, false, [], some 10, [], false, 4⟩ 10 ⟨true, true, true⟩ =
      ⟨false, 0, false, [], none, [], false, 4⟩ := by
  decide

theorem cleanup_rejection_reachable :
    finishCleanup ⟨false, 0, false, [], some 11, [], false, 4⟩ 10 ⟨true, true, true⟩ =
      ⟨false, 0, false, [], some 11, [], false, 4⟩ := by
  decide

theorem prefix_success_reachable : finishPrefixCleanup (some 3) 3 false = none := by
  decide

theorem prefix_rejection_reachable : finishPrefixCleanup (some 4) 3 false = some 4 := by
  decide

theorem late_put_recleanup_reachable :
    retryInterruptedWrite (lateProviderPut (retryInterruptedWrite ⟨false, true, false⟩)) =
      ⟨false, true, false⟩ := by
  decide

end BoundaryVerification.Deletion
