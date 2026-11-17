namespace BoundaryVerification.Publication

/-- IDs and revisions stand for opaque DB values; a fresh revision is modeled by successor. -/
structure State where
  present : Bool
  owner : Nat
  isPublic : Bool
  publicId : Option Nat
  generation : Nat
  privatePayload : Nat
  dataRevision : Nat
  history : Nat
  usage : Nat
  deriving DecidableEq, Repr

structure Editor where
  user : Nat
  session : Bool
  sameOrigin : Bool
  validInput : Bool
  deriving DecidableEq, Repr

def mayEdit (s : State) (e : Editor) : Prop :=
  s.present = true ∧ e.user = s.owner ∧ e.session = true ∧
    e.sameOrigin = true ∧ e.validInput = true

instance (s : State) (e : Editor) : Decidable (mayEdit s e) := inferInstanceAs (Decidable (_ ∧ _ ∧ _ ∧ _ ∧ _))

/-- SQL's COALESCE retains the public ID on unpublish and republish. -/
def changePublication (s : State) (e : Editor) (publish : Bool) (newId : Nat) : State :=
  if mayEdit s e then
    { s with
      isPublic := publish
      publicId := some (s.publicId.getD newId)
      generation := if s.isPublic || publish then s.generation + 1 else s.generation }
  else s

def detailAllowed (s : State) (key : Nat) : Prop :=
  s.present = true ∧ s.isPublic = true ∧ s.publicId = some key

instance (s : State) (key : Nat) : Decidable (detailAllowed s key) := inferInstanceAs (Decidable (_ ∧ _ ∧ _))

def detail (s : State) (key : Nat) : State × Bool :=
  (s, decide (detailAllowed s key))

theorem detail_requires_existing (s : State) (key : Nat) (h : (detail s key).2 = true) :
    s.present = true := by
  have allowed : detailAllowed s key := of_decide_eq_true h
  exact allowed.1

theorem detail_requires_public (s : State) (key : Nat) (h : (detail s key).2 = true) :
    s.isPublic = true := by
  have allowed : detailAllowed s key := of_decide_eq_true h
  exact allowed.2.1

theorem detail_requires_key (s : State) (key : Nat) (h : (detail s key).2 = true) :
    s.publicId = some key := by
  have allowed : detailAllowed s key := of_decide_eq_true h
  exact allowed.2.2

theorem private_denied (s : State) (key : Nat) (h : s.isPublic = false) :
    (detail s key).2 = false := by
  simp [detail, detailAllowed, h]

theorem deleted_denied (s : State) (key : Nat) (h : s.present = false) :
    (detail s key).2 = false := by
  simp [detail, detailAllowed, h]

theorem missing_public_id_denied (s : State) (key : Nat) (h : s.publicId = none) :
    (detail s key).2 = false := by
  simp [detail, detailAllowed, h]

theorem read_preserves_state (s : State) (key : Nat) : (detail s key).1 = s := rfl

theorem edit_rejected_unchanged (s : State) (e : Editor) (publish : Bool) (newId : Nat)
    (h : ¬ mayEdit s e) : changePublication s e publish newId = s := by
  simp [changePublication, h]

theorem edit_requires_session (s : State) (e : Editor) (h : e.session = false)
    (publish : Bool) (newId : Nat) : changePublication s e publish newId = s := by
  apply edit_rejected_unchanged
  simp [mayEdit, h]

theorem edit_requires_owner (s : State) (e : Editor) (h : e.user ≠ s.owner)
    (publish : Bool) (newId : Nat) : changePublication s e publish newId = s := by
  apply edit_rejected_unchanged
  simp [mayEdit, h]

theorem edit_requires_same_origin (s : State) (e : Editor) (h : e.sameOrigin = false)
    (publish : Bool) (newId : Nat) : changePublication s e publish newId = s := by
  apply edit_rejected_unchanged
  simp [mayEdit, h]

theorem edit_preserves_business_data (s : State) (e : Editor) (publish : Bool) (newId : Nat) :
    let after := changePublication s e publish newId
    after.privatePayload = s.privatePayload ∧ after.dataRevision = s.dataRevision ∧
      after.history = s.history ∧ after.usage = s.usage := by
  simp only [changePublication]
  split <;> simp

theorem edit_retains_public_id (s : State) (e : Editor) (publish : Bool) (newId oldId : Nat)
    (h : s.publicId = some oldId) :
    (changePublication s e publish newId).publicId = some oldId := by
  simp only [changePublication]
  split <;> simp [h]

structure CacheEntry where
  generation : Nat
  page : Nat
  deriving DecidableEq, Repr

inductive DirectoryResult where
  | denied
  | database
  | cached (generation : Nat) (page : Nat)
  deriving DecidableEq, Repr

/-- Called only with a validated page. Revision failure denies only the available-cache path. -/
def directory (cacheAvailable : Bool) (revision : Option Nat) (entry : CacheEntry)
    (page : Nat) : DirectoryResult :=
  if cacheAvailable then
    match revision with
    | none => .denied
    | some current =>
      if entry.generation = current ∧ entry.page = page then .cached current page
      else .database
  else .database

theorem missing_revision_fail_closed (entry : CacheEntry) (page : Nat) :
    directory true none entry page = .denied := rfl

theorem cached_requires_current_generation (revision : Option Nat) (entry : CacheEntry)
    (page gen cachedPage : Nat)
    (h : directory true revision entry page = .cached gen cachedPage) :
    revision = some gen ∧ entry.generation = gen ∧ entry.page = page := by
  cases revision with
  | none => simp [directory] at h
  | some current =>
    simp only [directory, ↓reduceIte] at h
    split at h
    next ok =>
      cases h
      exact ⟨rfl, ok.1, ok.2⟩
    next => cases h

theorem stale_cache_not_used (current : Nat) (entry : CacheEntry) (page : Nat)
    (h : entry.generation ≠ current) : directory true (some current) entry page = .database := by
  simp [directory, h]

theorem changed_publication_invalidates_old_cache (s : State) (e : Editor)
    (publish : Bool) (newId page : Nat) (h : mayEdit s e)
    (active : s.isPublic = true ∨ publish = true) :
    directory true (some (changePublication s e publish newId).generation)
      ⟨s.generation, page⟩ page = .database := by
  rcases active with oldPublic | newPublic
  · simp [changePublication, h, oldPublic, directory]
  · simp [changePublication, h, newPublic, directory]

def exampleState : State := ⟨true, 1, true, some 7, 10, 100, 2, 3, 4⟩
def exampleEditor : Editor := ⟨1, true, true, true⟩

theorem success_reachable :
    (detail exampleState 7).2 = true ∧
    directory true (some 10) ⟨10, 1⟩ 1 = .cached 10 1 ∧
    (changePublication exampleState exampleEditor false 99).isPublic = false := by decide

theorem refusal_reachable :
    (detail exampleState 8).2 = false ∧
    directory true none ⟨10, 1⟩ 1 = .denied ∧
    changePublication exampleState { exampleEditor with user := 2 } false 99 = exampleState := by decide

end BoundaryVerification.Publication
