import McpVerification.Proofs

namespace McpVerification

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

end McpVerification
