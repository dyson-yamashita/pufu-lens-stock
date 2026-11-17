import McpVerification.State

namespace McpVerification

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

end McpVerification
