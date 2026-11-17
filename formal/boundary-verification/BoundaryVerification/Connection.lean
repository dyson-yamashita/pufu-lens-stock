import Std

namespace BoundaryVerification.Connection

inductive Scope where
  | projectsRead | stocksRead | stocksWrite | questionsRead | questionsWrite
  | pufusWrite | memoryRead | offline
  deriving DecidableEq, Repr

structure Grant where
  id : Nat
  owner : Nat
  scopes : List Scope
  projects : Option (List Nat)
  deriving DecidableEq, Repr

structure Settings where
  grant : Nat
  owner : Nat
  scopes : List Scope
  projects : Option (List Nat)
  revoked : Bool
  deriving DecidableEq, Repr

structure Project where
  id : Nat
  owner : Nat
  deriving DecidableEq, Repr

def lookup (rows : List Settings) (g : Grant) : Option Settings :=
  rows.find? (fun s => s.owner == g.owner && s.grant == g.id)

def currentScopes (g : Grant) (setting : Option Settings) : List Scope :=
  match setting with
  | none => g.scopes
  | some s => g.scopes.filter (fun scope => s.scopes.contains scope)

def currentProjects (g : Grant) (setting : Option Settings) : Option (List Nat) :=
  match setting with | none => g.projects | some s => s.projects

def revoked (setting : Option Settings) : Bool :=
  match setting with | none => false | some s => s.revoked

structure Request where
  providerVerified : Bool
  ownerExists : Bool
  onboarded : Bool
  propsOwner : Nat
  deriving DecidableEq, Repr

structure Access where
  scopes : List Scope
  projects : Option (List Nat)
  deriving DecidableEq, Repr

def resolve (r : Request) (g : Grant) (rows : List Settings) (projects : List Project) :
    Option Access :=
  let setting := lookup rows g
  if !(r.providerVerified && r.ownerExists && r.onboarded && r.propsOwner == g.owner) then none
  else if revoked setting then none
  else
    let scopes := currentScopes g setting
    match currentProjects g setting with
    | none => some ⟨scopes, none⟩
    | some permitted =>
      let existing := projects.filter (fun p => p.owner == g.owner && permitted.contains p.id)
      if existing.isEmpty then none else some ⟨scopes, some (existing.map Project.id)⟩

structure Manager where
  session : Bool
  authenticated : Bool
  sameOrigin : Bool
  onboarded : Bool
  user : Nat
  deriving DecidableEq, Repr

def managerAllowed (m : Manager) (g : Grant) : Bool :=
  m.session && m.authenticated && m.sameOrigin && m.onboarded && m.user == g.owner

def projectsOwned (owner : Nat) (selected : Option (List Nat)) (projects : List Project) : Bool :=
  match selected with
  | none => true
  | some ids => !ids.isEmpty && ids.all (fun id => projects.any (fun p => p.id == id && p.owner == owner))

structure State where
  settings : List Settings
  refreshCount : Nat
  business : Nat
  deriving DecidableEq, Repr

def replace (g : Grant) (setting : Settings) (rows : List Settings) : List Settings :=
  setting :: rows.filter (fun s => !(s.owner == g.owner && s.grant == g.id))

def edit (m : Manager) (g : Grant) (scopes : List Scope) (selected : Option (List Nat))
    (projects : List Project) (s : State) : State :=
  if managerAllowed m g && !revoked (lookup s.settings g) &&
      scopes.all (fun scope => g.scopes.contains scope) && projectsOwned g.owner selected projects then
    { s with settings := replace g ⟨g.id, g.owner, scopes, selected, false⟩ s.settings }
  else s

def revoke (m : Manager) (g : Grant) (s : State) : State :=
  if managerAllowed m g then
    { s with settings := replace g ⟨g.id, g.owner, [], none, true⟩ s.settings }
  else s

-- providerValid abstracts provider token validation; the callback reads current settings.
def refreshAllowed (providerValid : Bool) (g : Grant) (rows : List Settings) : Bool :=
  let setting := lookup rows g
  let allowed := match setting with | none => g.scopes | some s => s.scopes
  providerValid && !revoked setting && allowed.contains .offline

def refreshTTL (g : Grant) (rows : List Settings) : Nat :=
  if g.scopes.contains .offline && refreshAllowed true g rows then 30 else 0

def refresh (providerValid : Bool) (g : Grant) (s : State) : State :=
  if refreshAllowed providerValid g s.settings then { s with refreshCount := s.refreshCount + 1 }
  else s

def tool (required : Scope) (access : Access) (s : State) : State :=
  if access.scopes.contains required then { s with business := s.business + 1 } else s

theorem scopes_never_exceed_original (g : Grant) (setting : Option Settings) (scope : Scope)
    (h : scope ∈ currentScopes g setting) : scope ∈ g.scopes := by
  cases setting with
  | none => exact h
  | some s => exact (List.mem_filter.mp h).1

theorem latest_scope_required (g : Grant) (s : Settings) (scope : Scope)
    (h : scope ∈ currentScopes g (some s)) : scope ∈ s.scopes := by
  simpa using (List.mem_filter.mp h).2

theorem wrong_owner_rejected (r : Request) (g : Grant) (rows : List Settings)
    (projects : List Project) (h : r.propsOwner ≠ g.owner) :
    resolve r g rows projects = none := by
  simp [resolve, h]

theorem revoked_access_rejected (r : Request) (g : Grant) (rows : List Settings)
    (projects : List Project) (h : revoked (lookup rows g) = true) :
    resolve r g rows projects = none := by
  simp [resolve, h]

theorem revoked_refresh_rejected (valid : Bool) (g : Grant) (s : State)
    (h : revoked (lookup s.settings g) = true) : refresh valid g s = s := by
  simp [refresh, refreshAllowed, h]

theorem revoked_settings_cannot_revive (m : Manager) (g : Grant) (scopes : List Scope)
    (selected : Option (List Nat)) (projects : List Project) (s : State)
    (h : revoked (lookup s.settings g) = true) : edit m g scopes selected projects s = s := by
  simp [edit, h]

theorem refresh_preserves_business (valid : Bool) (g : Grant) (s : State) :
    (refresh valid g s).business = s.business := by
  unfold refresh
  split <;> rfl

theorem management_denial_preserves_all (m : Manager) (g : Grant) (scopes : List Scope)
    (selected : Option (List Nat)) (projects : List Project) (s : State)
    (h : managerAllowed m g = false) : edit m g scopes selected projects s = s := by
  simp [edit, h]

theorem missing_scope_preserves_business (required : Scope) (access : Access) (s : State)
    (h : required ∉ access.scopes) : tool required access s = s := by
  simp [tool, h]

def grant : Grant := ⟨7, 1, [.projectsRead, .offline], some [10]⟩
def request : Request := ⟨true, true, true, 1⟩
def manager : Manager := ⟨true, true, true, true, 1⟩
def projects : List Project := [⟨10, 1⟩, ⟨20, 1⟩, ⟨30, 2⟩]
def initial : State := ⟨[], 0, 9⟩
def changed : State := edit manager grant [.projectsRead, .offline] (some [20]) projects initial

theorem initial_success_example :
    resolve request grant initial.settings projects = some ⟨[.projectsRead, .offline], some [10]⟩ := by decide

theorem project_change_beyond_initial_grant_example :
    resolve request grant changed.settings projects = some ⟨[.projectsRead, .offline], some [20]⟩ := by decide

theorem all_projects_setting_example :
    resolve request grant (edit manager grant [.projectsRead] none projects changed).settings projects =
      some ⟨[.projectsRead], none⟩ := by decide

theorem empty_is_not_all_example :
    resolve request grant [⟨7, 1, [.projectsRead], some [], false⟩] projects = none := by decide

theorem foreign_project_rejected_example :
    resolve request grant [⟨7, 1, [.projectsRead], some [30], false⟩] projects = none := by decide

theorem foreign_settings_ignored_example :
    resolve request grant [⟨7, 2, [], none, true⟩] projects =
      some ⟨[.projectsRead, .offline], some [10]⟩ := by decide

theorem ungranted_scope_removed_example :
    currentScopes grant (some ⟨7, 1, [.projectsRead, .stocksWrite], none, false⟩) =
      [.projectsRead] := by decide

theorem revoked_denial_example :
    resolve request grant (revoke manager grant changed).settings projects = none := by decide

theorem refresh_success_example : refresh true grant changed = { changed with refreshCount := 1 } := by decide

theorem offline_removal_blocks_refresh_example :
    refresh true grant (edit manager grant [.projectsRead] none projects changed) =
      edit manager grant [.projectsRead] none projects changed := by decide

theorem offline_removal_zero_ttl_example :
    refreshTTL grant (edit manager grant [.projectsRead] none projects changed).settings = 0 := by decide

end BoundaryVerification.Connection
