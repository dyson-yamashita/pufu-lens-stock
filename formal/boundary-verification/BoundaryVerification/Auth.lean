import Std

namespace BoundaryVerification.Auth

inductive Kind where
  | anonymous | session | token | mcp
  deriving DecidableEq, Repr

inductive Method where
  | get | head | options | post | put | patch | delete
  deriving DecidableEq, Repr

-- Read classes denote exactly the regex alternatives in authentication.ts.
inductive Route where
  | me | onboarding | logout | projects | stocks | comments | memoryRead
  | stockRead | stockImages | pufus | questions | questionRead | pufuDetail | tokens | other
  deriving DecidableEq, Repr

structure Request where
  kind : Kind
  registered : Bool
  live : Bool
  onboarded : Bool
  sameOrigin : Bool
  method : Method
  route : Route
  deriving DecidableEq, Repr

def authenticated (r : Request) : Bool :=
  r.kind != .anonymous && r.registered && r.live

def safeMethod (m : Method) : Bool :=
  m == .get || m == .head || m == .options

def csrfAllowed (r : Request) : Bool :=
  r.kind != .session || safeMethod r.method || r.sameOrigin

def onboardingAllowed (r : Request) : Bool :=
  r.onboarded || (r.kind == .session &&
    ((r.route == .me && (r.method == .get || r.method == .delete)) ||
     (r.method == .post && (r.route == .onboarding || r.route == .logout))))

def tokenRoute (m : Method) (p : Route) : Bool :=
  (m == .get && p == .projects) || (m == .post && p == .stocks)

def mcpRoute (m : Method) (p : Route) : Bool :=
  match m, p with
  | .get, .comments | .get, .projects | .get, .memoryRead | .get, .stocks
  | .get, .stockRead | .get, .stockImages | .get, .pufus | .get, .questions
  | .get, .questionRead => true
  | .post, .stockImages | .post, .comments | .post, .stocks | .post, .questions
  | .post, .pufus | .patch, .pufuDetail => true
  | _, _ => false

def routeAllowed (r : Request) : Bool :=
  match r.kind with
  | .anonymous => false
  | .session => true
  | .token => tokenRoute r.method r.route
  | .mcp => mcpRoute r.method r.route

def apiAllowed (r : Request) : Bool :=
  authenticated r && csrfAllowed r && onboardingAllowed r && routeAllowed r

-- The MCP resource accepts a provider-verified MCP credential, never an API token.
def mcpEntrance (r : Request) : Bool :=
  r.kind == .mcp && authenticated r && r.onboarded

structure State where
  business : Nat
  usage : Nat
  deriving DecidableEq, Repr

def step (r : Request) (s : State) : State :=
  { business := if apiAllowed r && !safeMethod r.method then s.business + 1 else s.business
    usage := if r.kind == .token && authenticated r then s.usage + 1 else s.usage }

theorem unregistered_rejected (r : Request) (s : State) (h : r.registered = false) :
    (step r s).business = s.business := by
  simp [step, apiAllowed, authenticated, h]

theorem dead_credential_rejected (r : Request) (s : State) (h : r.live = false) :
    (step r s).business = s.business := by
  simp [step, apiAllowed, authenticated, h]

theorem cross_origin_session_rejected (r : Request) (s : State)
    (hk : r.kind = .session) (hm : safeMethod r.method = false)
    (ho : r.sameOrigin = false) : (step r s).business = s.business := by
  simp [step, apiAllowed, csrfAllowed, hk, hm, ho]

theorem policy_denial_preserves_business (r : Request) (s : State)
    (h : routeAllowed r = false) : (step r s).business = s.business := by
  simp [step, apiAllowed, h]

theorem onboarding_denial_preserves_business (r : Request) (s : State)
    (h : onboardingAllowed r = false) : (step r s).business = s.business := by
  simp [step, apiAllowed, h]

theorem allowed_reaches_operation (r : Request) (s : State) (h : apiAllowed r = true)
    (hm : safeMethod r.method = false) :
    (step r s).business = s.business + 1 := by
  simp [step, h, hm]

theorem safe_methods_preserve_business (r : Request) (s : State)
    (hm : safeMethod r.method = true) : (step r s).business = s.business := by
  simp [step, hm]

theorem valid_token_records_usage_even_if_denied (r : Request) (s : State)
    (hk : r.kind = .token) (ha : authenticated r = true) :
    (step r s).usage = s.usage + 1 := by
  simp [step, hk, ha]

theorem token_api_table (m : Method) (p : Route) :
    tokenRoute m p = true ↔ (m = .get ∧ p = .projects) ∨ (m = .post ∧ p = .stocks) := by
  simp [tokenRoute]

theorem mcp_management_denied (m : Method) : mcpRoute m .tokens = false := by
  cases m <;> rfl

theorem put_session_requires_origin (r : Request) (s : State)
    (hk : r.kind = .session) (hm : r.method = .put) (ho : r.sameOrigin = false) :
    (step r s).business = s.business := by
  apply cross_origin_session_rejected r s hk _ ho
  simp [safeMethod, hm]

theorem put_token_and_mcp_denied (r : Request)
    (hk : r.kind = .token ∨ r.kind = .mcp) (hm : r.method = .put) :
    apiAllowed r = false := by
  rcases hk with hk | hk <;>
    simp [apiAllowed, routeAllowed, tokenRoute, mcpRoute, hk, hm]

theorem shortcut_never_mcp (r : Request) (hk : r.kind = .token) :
    mcpEntrance r = false := by
  simp [mcpEntrance, hk]

def browserSave : Request := ⟨.session, true, true, true, true, .post, .stocks⟩
def shortcutSave : Request := { browserSave with kind := .token, sameOrigin := false }

theorem session_success_example : step browserSave ⟨4, 2⟩ = ⟨5, 2⟩ := by decide
theorem shortcut_success_example : step shortcutSave ⟨4, 2⟩ = ⟨5, 3⟩ := by decide
theorem mcp_success_example :
    step { browserSave with kind := .mcp, sameOrigin := false } ⟨4, 2⟩ = ⟨5, 2⟩ := by decide
theorem csrf_denial_example :
    step { browserSave with sameOrigin := false } ⟨4, 2⟩ = ⟨4, 2⟩ := by decide
theorem token_policy_denial_example :
    step { shortcutSave with route := .tokens } ⟨4, 2⟩ = ⟨4, 3⟩ := by decide
theorem onboarding_exception_example :
    apiAllowed { browserSave with onboarded := false, route := .onboarding } = true := by decide
theorem onboarding_token_denial_example :
    apiAllowed { shortcutSave with onboarded := false } = false := by decide

end BoundaryVerification.Auth
