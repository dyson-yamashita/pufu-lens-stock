namespace McpVerification

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

end McpVerification
