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

-- Lower-level callback guard: the provider has already validated a credential.
-- With settings present, the callback itself checks only the latest offline scope.
def refreshAllowed (g : Grant) (rows : List Settings) : Bool :=
  let setting := lookup rows g
  let allowed := match setting with | none => g.scopes | some s => s.scopes
  !revoked setting && allowed.contains .offline

def refreshTTL (g : Grant) (rows : List Settings) : Nat :=
  let allowed := match lookup rows g with | none => g.scopes | some s => s.scopes
  if g.scopes.contains .offline && allowed.contains .offline then 30 else 0

def refreshCallback (g : Grant) (s : State) : State :=
  if refreshAllowed g s.settings then { s with refreshCount := s.refreshCount + 1 }
  else s

-- Issuance retains the provider's original grant, independently of later DB settings.
structure RefreshCredential where
  grant : Grant
  deriving DecidableEq, Repr

def mintRefresh (g : Grant) (issuanceRows : List Settings) : Option RefreshCredential :=
  if !revoked (lookup issuanceRows g) && refreshTTL g issuanceRows != 0 then some ⟨g⟩
  else none

-- The remaining validation (current/previous token, client, expiry, unwrap) is external.
-- A true Bool cannot manufacture a credential absent from authorization-code issuance.
def validateRefresh (providerValid : Bool) (credential : Option RefreshCredential) : Option Grant :=
  if providerValid then credential.map RefreshCredential.grant else none

-- Public entry: issuance settings and callback-time settings can differ arbitrarily.
def refresh (providerValid : Bool) (g : Grant) (issuanceRows : List Settings) (s : State) : State :=
  match validateRefresh providerValid (mintRefresh g issuanceRows) with
  | none => s
  | some originalGrant => refreshCallback originalGrant s

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

theorem revoked_refresh_rejected (valid : Bool) (g : Grant) (issuanceRows : List Settings) (s : State)
    (h : revoked (lookup s.settings g) = true) : refresh valid g issuanceRows s = s := by
  cases valid <;>
    by_cases minted : (!revoked (lookup issuanceRows g) && refreshTTL g issuanceRows != 0) = true <;>
    simp [refresh, mintRefresh, validateRefresh, minted, refreshCallback, refreshAllowed, h]

theorem original_offline_missing_zero_ttl (g : Grant) (rows : List Settings)
    (h : .offline ∉ g.scopes) : refreshTTL g rows = 0 := by
  simp [refreshTTL, h]

theorem original_offline_missing_no_credential (g : Grant) (issuanceRows : List Settings)
    (h : .offline ∉ g.scopes) : mintRefresh g issuanceRows = none := by
  simp [mintRefresh, original_offline_missing_zero_ttl g issuanceRows h]

theorem minted_credential_preserves_original (g : Grant) (issuanceRows : List Settings)
    (credential : RefreshCredential) (h : mintRefresh g issuanceRows = some credential) :
    credential.grant = g := by
  unfold mintRefresh at h
  split at h
  · have original : (⟨g⟩ : RefreshCredential) = credential := Option.some.inj h
    rw [← original]
  · contradiction

theorem original_offline_missing_refresh_rejected (valid : Bool) (g : Grant)
    (issuanceRows : List Settings) (s : State) (h : .offline ∉ g.scopes) :
    refresh valid g issuanceRows s = s := by
  simp [refresh, original_offline_missing_no_credential g issuanceRows h, validateRefresh]

theorem latest_offline_missing_refresh_rejected (valid : Bool) (g : Grant)
    (issuanceRows : List Settings) (s : State) (setting : Settings)
    (found : lookup s.settings g = some setting) (h : .offline ∉ setting.scopes) :
    refresh valid g issuanceRows s = s := by
  cases valid <;>
    by_cases minted : (!revoked (lookup issuanceRows g) && refreshTTL g issuanceRows != 0) = true <;>
    simp [refresh, mintRefresh, validateRefresh, minted, refreshCallback, refreshAllowed, found, h]

theorem provider_denial_preserves_all (g : Grant) (issuanceRows : List Settings) (s : State) :
    refresh false g issuanceRows s = s := by
  simp [refresh, validateRefresh]

theorem revoked_settings_cannot_revive (m : Manager) (g : Grant) (scopes : List Scope)
    (selected : Option (List Nat)) (projects : List Project) (s : State)
    (h : revoked (lookup s.settings g) = true) : edit m g scopes selected projects s = s := by
  simp [edit, h]

theorem refresh_preserves_business (valid : Bool) (g : Grant) (issuanceRows : List Settings) (s : State) :
    (refresh valid g issuanceRows s).business = s.business := by
  unfold refresh
  split
  · rfl
  · unfold refreshCallback
    split <;> rfl

theorem refresh_preserves_settings (valid : Bool) (g : Grant) (issuanceRows : List Settings) (s : State) :
    (refresh valid g issuanceRows s).settings = s.settings := by
  unfold refresh
  split
  · rfl
  · unfold refreshCallback
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

theorem refresh_success_example : refresh true grant initial.settings changed = { changed with refreshCount := 1 } := by decide

theorem offline_removal_blocks_refresh_example :
    refresh true grant initial.settings (edit manager grant [.projectsRead] none projects changed) =
      edit manager grant [.projectsRead] none projects changed := by decide

theorem offline_removal_zero_ttl_example :
    refreshTTL grant (edit manager grant [.projectsRead] none projects changed).settings = 0 := by decide

def noOfflineGrant : Grant := ⟨7, 1, [.projectsRead], some [10]⟩
def offlineAdded : State := ⟨[⟨7, 1, [.projectsRead, .offline], some [10], false⟩], 0, 9⟩

-- The callback alone has no credential/provenance guard, matching the implementation.
-- The public entry excludes this case through issuance and provider validation.
theorem callback_alone_accepts_added_offline_example :
    refreshCallback noOfflineGrant offlineAdded = { offlineAdded with refreshCount := 1 } := by decide

theorem added_offline_cannot_mint_example :
    mintRefresh noOfflineGrant offlineAdded.settings = none := by decide

theorem added_offline_zero_ttl_example :
    refreshTTL noOfflineGrant offlineAdded.settings = 0 := by decide

theorem added_offline_cannot_refresh_example :
    refresh true noOfflineGrant offlineAdded.settings offlineAdded = offlineAdded := by decide

theorem added_offline_after_issuance_cannot_refresh_example :
    refresh true noOfflineGrant initial.settings offlineAdded = offlineAdded := by decide

end BoundaryVerification.Connection
