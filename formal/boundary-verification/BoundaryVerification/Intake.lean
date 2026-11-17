import Std

/-! B14: image admission/conditional finalization and bounded parser output.
    Detection, schema checking and storage success are implementation observations;
    their algorithms are outside this model. -/
namespace BoundaryVerification.Intake

inductive Format where
  | png | jpeg | gif | webp
  deriving DecidableEq, Repr

structure Access where
  actor : Option Nat
  shortcut : Bool
  projects : Option (List Nat)
  deriving DecidableEq, Repr

structure Parent where
  present : Bool
  owner : Nat
  project : Nat
  deriving DecidableEq, Repr

def inScope (projects : Option (List Nat)) (project : Nat) : Bool :=
  match projects with
  | none => true
  | some ids => ids.contains project

def authorized (a : Access) (p : Parent) : Bool :=
  a.actor == some p.owner && !a.shortcut && p.present && inScope a.projects p.project

structure ImageInput where
  filenameValid : Bool
  bytes : Nat
  detected : Option Format
  supplied : Format
  deriving DecidableEq, Repr

def acceptable (i : ImageInput) : Bool :=
  i.filenameValid && decide (i.bytes ≤ 5 * 1024 * 1024) && i.detected == some i.supplied

structure Images where
  count : Nat
  pendingKey : Option Nat
  readyKey : Option Nat
  cleanup : List Nat
  deriving DecidableEq, Repr

structure Result where
  accepted : Bool
  state : Images
  deriving DecidableEq, Repr

-- A fresh ID is the insert path. Existing-ID replay/conflict is tested separately.
def reserve (a : Access) (p : Parent) (i : ImageInput) (key : Nat) (s : Images) : Result :=
  if authorized a p && acceptable i && decide (s.count < 5) && s.pendingKey == none then
    ⟨true, { s with count := s.count + 1, pendingKey := some key }⟩
  else ⟨false, s⟩

structure Upload where
  actor : Nat
  projects : Option (List Nat)
  key : Nat
  deriving DecidableEq, Repr

-- Re-read ownership/project and match the unique object key at final SQL.
def mayFinalize (u : Upload) (p : Parent) (written : Bool) (s : Images) : Bool :=
  written && p.present && (p.owner == u.actor) && inScope u.projects p.project &&
    (s.pendingKey == some u.key)

def finish (u : Upload) (p : Parent) (written : Bool) (s : Images) : Result :=
  if mayFinalize u p written s then
    ⟨true, { s with pendingKey := none, readyKey := some u.key }⟩
  else
    ⟨false, { s with
      pendingKey := if s.pendingKey == some u.key then none else s.pendingKey
      cleanup := u.key :: s.cleanup }⟩

theorem unauthenticated_denied (a : Access) (p : Parent) (i : ImageInput) (key : Nat)
    (s : Images) (h : a.actor = none) : reserve a p i key s = ⟨false, s⟩ := by
  simp [reserve, authorized, h]

theorem shortcut_denied (a : Access) (p : Parent) (i : ImageInput) (key : Nat)
    (s : Images) (h : a.shortcut = true) : reserve a p i key s = ⟨false, s⟩ := by
  simp [reserve, authorized, h]

theorem oversized_denied (a : Access) (p : Parent) (i : ImageInput) (key : Nat)
    (s : Images) (h : 5 * 1024 * 1024 < i.bytes) : reserve a p i key s = ⟨false, s⟩ := by
  have hn : ¬ i.bytes ≤ 5 * 1024 * 1024 := by omega
  simp [reserve, acceptable, hn]

theorem signature_mismatch_denied (a : Access) (p : Parent) (i : ImageInput) (key : Nat)
    (s : Images) (h : i.detected ≠ some i.supplied) : reserve a p i key s = ⟨false, s⟩ := by
  simp [reserve, acceptable, h]

theorem pending_counts_towards_limit (a : Access) (p : Parent) (i : ImageInput)
    (key : Nat) (s : Images) (h : 5 ≤ s.count) : reserve a p i key s = ⟨false, s⟩ := by
  have hn : ¬ s.count < 5 := by omega
  simp [reserve, hn]

theorem reservation_keeps_ready (a : Access) (p : Parent) (i : ImageInput)
    (key : Nat) (s : Images) : (reserve a p i key s).state.readyKey = s.readyKey := by
  unfold reserve
  split <;> rfl

theorem reservation_bounded (a : Access) (p : Parent) (i : ImageInput)
    (key : Nat) (s : Images) (h : (reserve a p i key s).accepted = true) :
    (reserve a p i key s).state.count ≤ 5 := by
  unfold reserve at *
  split at h
  · rename_i hc
    have : s.count < 5 := by
      simpa using (Bool.and_eq_true_iff.mp (Bool.and_eq_true_iff.mp hc).1).2
    simp only [hc, ↓reduceIte]
    omega
  · contradiction

theorem finalize_deleted_parent_denied (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : p.present = false) : (finish u p written s).accepted = false := by
  simp [finish, mayFinalize, h]

theorem finalize_scope_rechecked (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : inScope u.projects p.project = false) :
    (finish u p written s).accepted = false := by
  simp [finish, mayFinalize, h]

theorem finalize_owner_rechecked (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : p.owner ≠ u.actor) : (finish u p written s).accepted = false := by
  simp [finish, mayFinalize, h]

theorem finalize_key_rechecked (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : s.pendingKey ≠ some u.key) :
    (finish u p written s).accepted = false := by
  simp [finish, mayFinalize, h]

theorem denied_finalize_keeps_ready (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : mayFinalize u p written s = false) :
    (finish u p written s).state.readyKey = s.readyKey ∧
    (finish u p written s).state.cleanup = u.key :: s.cleanup := by
  simp [finish, h]

theorem successful_finalize (u : Upload) (p : Parent) (s : Images)
    (written : Bool) (h : mayFinalize u p written s = true) :
    (finish u p written s).accepted = true ∧
    (finish u p written s).state.readyKey = some u.key := by
  simp [finish, h]

structure PdfOutput where
  status : Nat
  errorIsString : Bool
  responseBytes : Nat
  titleIsString : Bool
  titleLength : Nat
  textIsString : Bool
  textLength : Nat
  deriving DecidableEq, Repr

def serviceAccepts (o : PdfOutput) : Bool :=
  decide (200 ≤ o.status ∧ o.status < 300) || (o.status == 422 && !o.errorIsString)

def acceptPdf (o : PdfOutput) : Bool :=
  serviceAccepts o && decide (o.responseBytes ≤ 1024 * 1024) && o.titleIsString &&
    decide (o.titleLength ≤ 300) && o.textIsString &&
    decide (200 ≤ o.textLength) && decide (o.textLength ≤ 120000)

theorem pdf_error_status_denied (o : PdfOutput)
    (h : ¬ (200 ≤ o.status ∧ o.status < 300)) (h422 : o.status ≠ 422) :
    acceptPdf o = false := by simp [acceptPdf, serviceAccepts, h, h422]

theorem pdf_422_error_denied (o : PdfOutput)
    (hs : o.status = 422) (he : o.errorIsString = true) : acceptPdf o = false := by
  simp [acceptPdf, serviceAccepts, hs, he]

theorem pdf_short_text_denied (o : PdfOutput) (h : o.textLength < 200) :
    acceptPdf o = false := by
  have hn : ¬ 200 ≤ o.textLength := by omega
  simp [acceptPdf, hn]

theorem pdf_large_response_denied (o : PdfOutput) (h : 1024 * 1024 < o.responseBytes) :
    acceptPdf o = false := by
  have hn : ¬ o.responseBytes ≤ 1024 * 1024 := by omega
  simp [acceptPdf, hn]

-- finish_reason can be stop, missing or null; present incomplete reasons fail.
structure AiOutput where
  chatEnvelopeAccepted : Bool
  jsonDecoded : Bool
  schemaAccepted : Bool
  deriving DecidableEq, Repr

def acceptAi (o : AiOutput) : Bool :=
  o.chatEnvelopeAccepted && o.jsonDecoded && o.schemaAccepted

theorem invalid_ai_schema_denied (o : AiOutput) (h : o.schemaAccepted = false) :
    acceptAi o = false := by simp [acceptAi, h]

theorem incomplete_chat_denied (o : AiOutput) (h : o.chatEnvelopeAccepted = false) :
    acceptAi o = false := by simp [acceptAi, h]

def goodAccess : Access := ⟨some 1, false, some [10]⟩
def goodParent : Parent := ⟨true, 1, 10⟩
def goodImage : ImageInput := ⟨true, 100, some .png, .png⟩
def emptyImages : Images := ⟨0, none, none, []⟩

theorem image_success_reachable :
    (reserve goodAccess goodParent goodImage 7 emptyImages).accepted = true ∧
    (finish ⟨1, some [10], 7⟩ goodParent true
      (reserve goodAccess goodParent goodImage 7 emptyImages).state).state.readyKey = some 7 := by
  decide

theorem image_rejection_reachable :
    (reserve { goodAccess with actor := none } goodParent goodImage 7 emptyImages).accepted = false := by
  decide

theorem output_success_reachable :
    acceptPdf ⟨200, false, 512, true, 10, true, 200⟩ = true ∧
    acceptAi ⟨true, true, true⟩ = true := by decide

-- Existing client behavior: a 422 with no string error still reaches shape checks.
theorem pdf_422_shape_reachable :
    acceptPdf ⟨422, false, 512, true, 10, true, 200⟩ = true := by decide

end BoundaryVerification.Intake
