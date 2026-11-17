import Std

namespace BoundaryVerification.Network

inductive Scheme where
  | http | https | other
  deriving DecidableEq, Repr

-- URL parsing/normalization and ipaddr.js classification are trusted inputs.
structure Url where
  parsed : Bool
  length : Nat
  scheme : Scheme
  username : Bool
  password : Bool
  port : Option Nat
  dottedOrIpv6 : Bool
  blockedHost : Bool
  literal : Bool
  literalPublic : Bool
  deriving DecidableEq, Repr

def urlAllowed (u : Url) : Prop :=
  u.parsed = true ∧ u.length ≤ 4096 ∧
  (u.scheme = .http ∨ u.scheme = .https) ∧
  (u.username = false ∧ u.password = false) ∧
  (u.port = none ∨ u.port = some 80 ∨ u.port = some 443) ∧
  u.dottedOrIpv6 = true ∧ u.blockedHost = false ∧
  (u.literal = false ∨ u.literalPublic = true)

instance (u : Url) : Decidable (urlAllowed u) := by
  unfold urlAllowed
  infer_instance

-- Only A/AAAA answers from both replies are included in addresses.
structure Dns where
  httpOk : Bool
  statusA : Nat
  statusAAAA : Nat
  addresses : List Bool
  deriving DecidableEq, Repr

def dnsAllowed (d : Dns) : Prop :=
  d.httpOk = true ∧ (d.statusA = 0 ∨ d.statusA = 3) ∧
  (d.statusAAAA = 0 ∨ d.statusAAAA = 3) ∧
  d.addresses ≠ [] ∧ d.addresses.all id = true

instance (d : Dns) : Decidable (dnsAllowed d) := by
  unfold dnsAllowed
  infer_instance

structure Destination where
  url : Url
  dns : Dns
  deriving DecidableEq, Repr

def destinationAllowed (d : Destination) : Prop :=
  urlAllowed d.url ∧ (d.url.literal = true ∨ dnsAllowed d.dns)

instance (d : Destination) : Decidable (destinationAllowed d) := by
  unfold destinationAllowed
  infer_instance

structure Request where
  destination : Destination
  callerGuard : Bool
  beforeDeadline : Bool
  youtube : Bool
  deriving DecidableEq, Repr

def requestAllowed (r : Request) : Prop :=
  destinationAllowed r.destination ∧ r.callerGuard = true ∧
  r.beforeDeadline = true ∧ r.youtube = false

instance (r : Request) : Decidable (requestAllowed r) := by
  unfold requestAllowed
  infer_instance

inductive Reply where
  | terminal
  | redirect (validLocation : Bool)
  deriving DecidableEq, Repr

structure State where
  remaining : Nat
  stopped : Bool
  finished : Bool
  fetched : List Destination
  deriving DecidableEq, Repr

def initial : State := ⟨6, false, false, []⟩

-- Each redirect re-enters this transition with its new destination. The
-- implicit HTTP redirect mechanism is disabled by redirect: 'manual'.
def step (s : State) (r : Request) (reply : Reply) : State :=
  if s.stopped = true ∨ s.finished = true then s
  else if s.remaining = 0 then { s with stopped := true }
  else if requestAllowed r then
    let fetched := s.fetched ++ [r.destination]
    match reply with
    | .terminal => ⟨s.remaining - 1, false, true, fetched⟩
    | .redirect valid =>
      ⟨s.remaining - 1, !valid || decide (s.remaining = 1), false, fetched⟩
  else { s with stopped := true }

def traceAllowed (s : State) : Prop :=
  ∀ d ∈ s.fetched, destinationAllowed d

theorem allowed_url_has_no_credentials (u : Url) (h : urlAllowed u) :
    u.username = false ∧ u.password = false := by
  exact h.2.2.2.1

theorem allowed_url_scheme_port_host (u : Url) (h : urlAllowed u) :
    (u.scheme = .http ∨ u.scheme = .https) ∧
    (u.port = none ∨ u.port = some 80 ∨ u.port = some 443) ∧
    u.dottedOrIpv6 = true ∧ u.blockedHost = false := by
  exact ⟨h.2.2.1, h.2.2.2.2.1, h.2.2.2.2.2.1, h.2.2.2.2.2.2.1⟩

theorem nonliteral_requires_dns (d : Destination) (h : destinationAllowed d)
    (hn : d.url.literal = false) : dnsAllowed d.dns := by
  rcases h.2 with hl | hd
  · simp [hn] at hl
  · exact hd

theorem dns_rejects_any_private_answer (d : Dns) (h : dnsAllowed d) :
    false ∉ d.addresses := by
  intro hm
  have hall := (List.all_eq_true.mp h.2.2.2.2) false hm
  simp at hall

theorem rejected_request_does_not_fetch (s : State) (r : Request) (reply : Reply)
    (h : ¬ requestAllowed r) : (step s r reply).fetched = s.fetched := by
  simp only [step]
  split
  · rfl
  · split
    · rfl
    · rfl

theorem stopped_never_fetches_again (s : State) (r : Request) (reply : Reply)
    (h : s.stopped = true) : step s r reply = s := by
  simp [step, h]

theorem redirect_preserves_checked_trace (s : State) (r : Request) (reply : Reply)
    (h : traceAllowed s) : traceAllowed (step s r reply) := by
  unfold step
  split
  · exact h
  · split
    · exact h
    · split
      next hr =>
        cases reply <;>
          simp only [traceAllowed, List.mem_append, List.mem_singleton] at * <;>
          intro d hm <;> rcases hm with hm | hm
        · exact h d hm
        · subst d; exact hr.1
        · exact h d hm
        · subst d; exact hr.1
      next => exact h

theorem budget_never_increases (s : State) (r : Request) (reply : Reply) :
    (step s r reply).remaining ≤ s.remaining := by
  unfold step
  split
  · exact Nat.le_refl _
  · split
    · exact Nat.le_refl _
    · split
      · cases reply <;> simp <;> omega
      · exact Nat.le_refl _

-- Processing an arbitrary sequence of redirect replies cannot append an
-- unchecked hop or exceed the initial six-request budget.
def run (s : State) (requests : List (Request × Reply)) : State :=
  requests.foldl (fun state event => step state event.1 event.2) s

theorem step_conserves_budget (s : State) (r : Request) (reply : Reply) :
    (step s r reply).fetched.length + (step s r reply).remaining =
      s.fetched.length + s.remaining := by
  unfold step
  split
  · rfl
  · split
    · rfl
    next hn =>
      split
      · cases reply <;> simp only [List.length_append, List.length_singleton] <;> omega
      · rfl

theorem run_preserves_checked_trace (s : State) (events : List (Request × Reply))
    (h : traceAllowed s) : traceAllowed (run s events) := by
  induction events generalizing s with
  | nil => exact h
  | cons event rest ih =>
    exact ih (step s event.1 event.2) (redirect_preserves_checked_trace s event.1 event.2 h)

theorem run_conserves_budget (s : State) (events : List (Request × Reply)) :
    (run s events).fetched.length + (run s events).remaining =
      s.fetched.length + s.remaining := by
  induction events generalizing s with
  | nil => rfl
  | cons event rest ih =>
    exact (ih (step s event.1 event.2)).trans (step_conserves_budget s event.1 event.2)

theorem no_more_than_six_fetches (events : List (Request × Reply)) :
    (run initial events).fetched.length ≤ 6 := by
  have budget := run_conserves_budget initial events
  change (run initial events).fetched.length + (run initial events).remaining = 6 at budget
  omega

def publicUrl : Url := ⟨true, 25, .https, false, false, none, true, false, false, false⟩
def publicDns : Dns := ⟨true, 0, 0, [true]⟩
def publicRequest : Request := ⟨⟨publicUrl, publicDns⟩, true, true, false⟩
def privateRedirect : Request :=
  { publicRequest with destination := ⟨publicUrl, ⟨true, 0, 0, [true, false]⟩⟩ }

theorem successful_fetch_reachable :
    (step initial publicRequest .terminal).finished = true ∧
    (step initial publicRequest .terminal).fetched = [publicRequest.destination] := by
  decide

theorem unsafe_redirect_stops_before_second_fetch :
    let first := step initial publicRequest (.redirect true)
    (step first privateRedirect .terminal).stopped = true ∧
    (step first privateRedirect .terminal).fetched = [publicRequest.destination] := by
  decide

theorem sixth_redirect_stops :
    (step { initial with remaining := 1 } publicRequest (.redirect true)).stopped = true := by
  decide

end BoundaryVerification.Network
