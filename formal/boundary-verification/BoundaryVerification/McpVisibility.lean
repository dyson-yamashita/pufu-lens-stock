import Std

namespace BoundaryVerification.McpVisibility

inductive Scope where
  | projectsRead | stocksRead | stocksWrite | questionsRead | questionsWrite
  | memoriesRead | pufusWrite
  deriving Repr, DecidableEq

inductive Target where
  | stock | question | pufu
  deriving Repr, DecidableEq

def commentScope (target : Target) (write : Bool) : Scope :=
  match target, write with
  | .stock, false => .stocksRead
  | .stock, true => .stocksWrite
  | _, false => .questionsRead
  | _, true => .questionsWrite

structure Principal where
  user : Nat
  scopes : List Scope
  -- none = every owned project; some [] = no project, never unrestricted.
  projects : Option (List Nat)
  deriving Repr, DecidableEq

structure Row where
  owner : Nat
  project : Nat
  showInAll : Bool
  privateData : Nat
  deriving Repr, DecidableEq

def projectAllowed (p : Principal) (project : Nat) : Bool :=
  match p.projects with
  | none => true
  | some ids => decide (project ∈ ids)

def access (p : Principal) (required : Scope) (row : Row) : Bool :=
  decide (required ∈ p.scopes) && decide (row.owner = p.user) && projectAllowed p row.project

def detail (p : Principal) (required : Scope) (row : Row) : Option Nat :=
  if access p required row then some row.privateData else none

theorem access_conditions (p : Principal) (required : Scope) (row : Row) :
    access p required row = true ↔
    required ∈ p.scopes ∧ row.owner = p.user ∧ projectAllowed p row.project = true := by
  simp [access, Bool.and_eq_true, and_assoc]

theorem detail_missing_scope (p : Principal) (required : Scope) (row : Row)
    (h : required ∉ p.scopes) : detail p required row = none := by
  simp [detail, access, h]

theorem detail_wrong_owner (p : Principal) (required : Scope) (row : Row)
    (h : row.owner ≠ p.user) : detail p required row = none := by
  simp [detail, access, h]

theorem detail_outside_project (p : Principal) (required : Scope) (row : Row)
    (h : projectAllowed p row.project = false) : detail p required row = none := by
  simp [detail, access, h]

theorem detail_permitted (p : Principal) (required : Scope) (row : Row)
    (hs : required ∈ p.scopes) (ho : row.owner = p.user)
    (hp : projectAllowed p row.project = true) : detail p required row = some row.privateData := by
  simp [detail, access, hs, ho, hp]

def requestedAllowed (requested : Option Nat) (row : Row) : Bool :=
  match requested with
  | none => true
  | some project => decide (row.project = project)

-- Project listings include hidden projects; item listings use projectListFilter.
def visible (p : Principal) (requested : Option Nat) (projectListing : Bool) (row : Row) : Bool :=
  projectListing || requested.isSome || p.projects.isSome || row.showInAll

def listPredicate (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (row : Row) : Bool :=
  access p required row && requestedAllowed requested row && visible p requested projectListing row

def filtered (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) : List Row :=
  rows.filter (listPredicate p required requested projectListing)

def page (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) (offset limit : Nat) : List Row :=
  ((filtered p required requested projectListing rows).drop offset).take limit

def total (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) : Nat :=
  (filtered p required requested projectListing rows).length

theorem filtered_subset_permitted (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) (row : Row)
    (h : row ∈ filtered p required requested projectListing rows) :
    required ∈ p.scopes ∧ row.owner = p.user ∧ projectAllowed p row.project = true := by
  have hf := (List.mem_filter.mp h).2
  have ha : access p required row = true := by
    simp only [listPredicate, Bool.and_eq_true] at hf
    exact hf.1.1
  exact (access_conditions p required row).mp ha

theorem page_subset_permitted (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) (offset limit : Nat) (row : Row)
    (h : row ∈ page p required requested projectListing rows offset limit) :
    required ∈ p.scopes ∧ row.owner = p.user ∧ projectAllowed p row.project = true := by
  exact filtered_subset_permitted p required requested projectListing rows row
    (List.mem_of_mem_drop (List.mem_of_mem_take h))

theorem total_counts_only_filtered (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) :
    total p required requested projectListing rows =
      (rows.filter (listPredicate p required requested projectListing)).length := by rfl

theorem total_ignores_forbidden_row (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) (row : Row)
    (h : access p required row = false) :
    total p required requested projectListing (row :: rows) =
      total p required requested projectListing rows := by
  simp [total, filtered, listPredicate, h]

theorem empty_selection_no_rows (p : Principal) (required : Scope) (requested : Option Nat)
    (projectListing : Bool) (rows : List Row) (h : p.projects = some []) :
    filtered p required requested projectListing rows = [] ∧
    total p required requested projectListing rows = 0 := by
  simp [filtered, total, listPredicate, access, projectAllowed, h]

theorem hidden_global_excluded (p : Principal) (required : Scope) (row : Row)
    (hp : p.projects = none) (hh : row.showInAll = false) :
    listPredicate p required none false row = false := by
  simp [listPredicate, visible, hp, hh]

theorem hidden_selected_included (p : Principal) (required : Scope) (row : Row)
    (ha : access p required row = true) (ids : List Nat) (hp : p.projects = some ids) :
    listPredicate p required none false row = true := by
  simp [listPredicate, requestedAllowed, visible, ha, hp]

theorem explicit_project_included (p : Principal) (required : Scope) (row : Row)
    (ha : access p required row = true) :
    listPredicate p required (some row.project) false row = true := by
  simp [listPredicate, requestedAllowed, visible, ha]

structure WriteState where
  savedInputs : List Nat
  privateRows : List Row
  revisions : List Nat
  relations : List Nat
  histories : List Nat
  usage : Nat
  deriving Repr, DecidableEq

structure WriteResult where
  accepted : Bool
  response : Option Nat
  state : WriteState
  deriving Repr, DecidableEq

-- add_question's MCP wrapper projects submitted fields, including on a retry.
-- IDs and schema/relation validation are abstracted; privateRows is preexisting data.
def questionWrite (p : Principal) (target : Row) (submitted : Nat) (s : WriteState) : WriteResult :=
  if access p .questionsWrite target then
    ⟨true, some submitted, { s with savedInputs := s.savedInputs ++ [submitted] }⟩
  else ⟨false, none, s⟩

theorem write_denied_unchanged (p : Principal) (target : Row) (submitted : Nat) (s : WriteState)
    (h : access p .questionsWrite target = false) :
    questionWrite p target submitted s = ⟨false, none, s⟩ := by
  simp [questionWrite, h]

theorem question_response_only_submitted (p : Principal) (target : Row) (submitted : Nat)
    (s : WriteState) (h : access p .questionsWrite target = true) :
    (questionWrite p target submitted s).response = some submitted := by
  simp [questionWrite, h]

def reader : Principal := ⟨1, [.questionsRead, .projectsRead], some [10]⟩
def hidden : Row := ⟨1, 10, false, 99⟩
def outsider : Row := ⟨2, 10, true, 100⟩

theorem detail_success_reachable : detail reader .questionsRead hidden = some 99 := by decide
theorem detail_rejection_reachable : detail reader .questionsRead outsider = none := by decide
theorem page_success_reachable :
    page reader .questionsRead none false [hidden, outsider] 0 24 = [hidden] := by decide
theorem empty_page_reachable :
    total { reader with projects := some [] } .questionsRead none false [hidden, outsider] = 0 := by
  decide
theorem pufu_comment_requires_questions_write : commentScope .pufu true = .questionsWrite := by rfl
theorem writer_success_reachable :
    (questionWrite ⟨1, [.questionsWrite], some [10]⟩ hidden 7 ⟨[], [hidden], [1], [], [], 0⟩).response =
      some 7 := by decide
theorem writer_missing_scope_reachable :
    (questionWrite reader hidden 7 ⟨[], [hidden], [1], [], [], 0⟩).accepted = false := by decide

end BoundaryVerification.McpVisibility
