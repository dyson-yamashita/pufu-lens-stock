namespace Verification.McpUpdate

-- Resolved server-side identity and grants, never client-supplied claims.
structure Access where
  authenticated : Bool
  writeScope : Bool
  ownsPufu : Bool
  projectId : Nat
  -- none = all projects; some [] = no projects (project-access.ts).
  projectIds : Option (List Nat)

def projectAllowed (a : Access) : Bool :=
  match a.projectIds with
  | none => true
  | some ids => ids.contains a.projectId

def authorized (a : Access) : Bool :=
  a.authenticated && a.writeScope && a.ownsPufu && projectAllowed a

theorem unauthenticated_not_authorized (a : Access) (h : a.authenticated = false) :
    authorized a = false := by
  simp [authorized, h]

theorem missing_scope_not_authorized (a : Access) (h : a.writeScope = false) :
    authorized a = false := by
  simp [authorized, h]

theorem non_owner_not_authorized (a : Access) (h : a.ownsPufu = false) :
    authorized a = false := by
  simp [authorized, h]

theorem outside_project_not_authorized (a : Access) (h : projectAllowed a = false) :
    authorized a = false := by
  simp [authorized, h]

theorem empty_projects_denied (a : Access) (h : a.projectIds = some []) :
    authorized a = false := by
  simp [authorized, projectAllowed, h]

-- Opaque serialized scores; JSON/schema/relations are checked outside this model.
-- Phases are already initialized and synchronized by initialPufuPhase.
structure State where
  latestData : String
  phases : Nat → String
  revision : Nat
  currentPhase : Nat

structure Update where
  data : String
  revision : Nat
  phase : Option Nat
  -- Abstracts ready status, existing phase, valid schema and relations,
  -- and the successful D1 batch; it is not an authorization assumption.
  valid : Bool

def targetPhase (s : State) (u : Update) : Nat :=
  u.phase.getD s.currentPhase

def canCommit (a : Access) (s : State) (u : Update) : Bool :=
  authorized a && u.valid && decide (u.revision = s.revision)

def commit (s : State) (u : Update) : State :=
  { latestData := if targetPhase s u = s.currentPhase then u.data else s.latestData
    phases := fun n => if n = targetPhase s u then u.data else s.phases n
    revision := s.revision + 1
    currentPhase := s.currentPhase }

structure Result where
  accepted : Bool
  state : State

def update (a : Access) (s : State) (u : Update) : Result :=
  if canCommit a s u then ⟨true, commit s u⟩ else ⟨false, s⟩

-- P1
theorem unauthenticated_denied (a : Access) (s : State) (u : Update)
    (h : a.authenticated = false) : (update a s u).accepted = false := by
  simp [update, canCommit, unauthenticated_not_authorized a h]

-- P2: scope, ownership and project restriction are independent controls.
theorem missing_scope_denied (a : Access) (s : State) (u : Update)
    (h : a.writeScope = false) : (update a s u).accepted = false := by
  simp [update, canCommit, missing_scope_not_authorized a h]

theorem non_owner_denied (a : Access) (s : State) (u : Update)
    (h : a.ownsPufu = false) : (update a s u).accepted = false := by
  simp [update, canCommit, non_owner_not_authorized a h]

theorem outside_project_denied (a : Access) (s : State) (u : Update)
    (h : projectAllowed a = false) : (update a s u).accepted = false := by
  simp [update, canCommit, outside_project_not_authorized a h]

-- P3: equality includes all phase data, latest JSON and the revision.
theorem rejected_unchanged (a : Access) (s : State) (u : Update)
    (h : (update a s u).accepted = false) : (update a s u).state = s := by
  unfold update at *
  split at h <;> simp_all

theorem unauthorized_unchanged (a : Access) (s : State) (u : Update)
    (h : authorized a = false) : (update a s u).state = s := by
  simp [update, canCommit, h]

theorem stale_revision_denied (a : Access) (s : State) (u : Update)
    (h : u.revision ≠ s.revision) : (update a s u).accepted = false := by
  simp [update, canCommit, h]

-- P4: normal update requires all guards, not permission alone.
theorem permitted_valid_update (a : Access) (s : State) (u : Update)
    (ha : authorized a = true) (hv : u.valid = true) (hr : u.revision = s.revision) :
    (update a s u).accepted = true ∧ (update a s u).state = commit s u := by
  simp [update, canCommit, ha, hv, hr]

theorem accepted_revision (a : Access) (s : State) (u : Update)
    (h : (update a s u).accepted = true) :
    (update a s u).state.revision = s.revision + 1 := by
  unfold update at *
  split at h <;> simp_all [commit]

theorem accepted_phase_data (a : Access) (s : State) (u : Update)
    (h : (update a s u).accepted = true) :
    (update a s u).state.phases (targetPhase s u) = u.data := by
  unfold update at *
  split at h <;> simp_all [commit]

theorem accepted_other_phase (a : Access) (s : State) (u : Update) (n : Nat)
    (h : (update a s u).accepted = true) (hn : n ≠ targetPhase s u) :
    (update a s u).state.phases n = s.phases n := by
  unfold update at *
  split at h <;> simp_all [commit]

theorem accepted_no_append (a : Access) (s : State) (u : Update)
    (h : (update a s u).accepted = true) :
    (update a s u).state.currentPhase = s.currentPhase := by
  unfold update at *
  split at h <;> simp_all [commit]

theorem accepted_latest_data (a : Access) (s : State) (u : Update)
    (h : (update a s u).accepted = true) :
    (update a s u).state.latestData =
      if targetPhase s u = s.currentPhase then u.data else s.latestData := by
  unfold update at *
  split at h <;> simp_all [commit]

private def sampleAccess : Access :=
  ⟨true, true, true, 1, some [1]⟩

private def sampleState : State :=
  ⟨"saved", fun _ => "saved", 1, 1⟩

private def sampleUpdate : Update :=
  ⟨"updated", 1, none, true⟩

-- The normal preconditions are jointly satisfiable; acceptance is reachable.
theorem successful_update_exists :
    ∃ a s u, authorized a = true ∧ u.valid = true ∧ u.revision = s.revision ∧
      (update a s u).accepted = true := by
  exact ⟨sampleAccess, sampleState, sampleUpdate, rfl, rfl, rfl, rfl⟩

-- Rejection and preservation are reachable with the same otherwise valid input.
theorem denied_update_exists :
    ∃ a s u, a.authenticated = false ∧ (update a s u).accepted = false ∧
      (update a s u).state = s := by
  exact ⟨{ sampleAccess with authenticated := false }, sampleState, sampleUpdate,
    rfl, rfl, rfl⟩

end Verification.McpUpdate
