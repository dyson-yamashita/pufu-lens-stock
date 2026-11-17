import McpVerification.Access

namespace McpVerification

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

end McpVerification
