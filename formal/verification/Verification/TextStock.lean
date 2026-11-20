import Verification.Auth

namespace Verification.TextStock

structure Version where
  article : Nat
  generation : Nat
  deriving DecidableEq, Repr

structure Article where
  version : Version
  body : Nat
  summary : Option Nat
  deriving DecidableEq, Repr

structure State where
  present : Bool
  owner : Nat
  textSource : Bool
  current : Article
  otherCopy : Option Article
  stockDetails : Nat
  projectMemoryRevision : Nat
  userMemoryRevision : Nat
  inUserMemory : Bool
  jobs : List Version
  deriving DecidableEq, Repr

structure Edit where
  version : Version
  body : Nat
  nonblank : Bool
  length : Nat
  forkId : Nat
  deriving DecidableEq, Repr

inductive Result where
  | rejected | unchanged | changed
  deriving DecidableEq, Repr

def canAccess (r : Auth.Request) (user : Nat) (edit : Edit) (s : State) : Bool :=
  Auth.apiAllowed { r with method := .patch, route := .stockRead } &&
  s.present && (s.owner == user) && s.textSource && edit.nonblank &&
    decide (edit.length ≤ 20000)

def nextVersion (edit : Edit) (s : State) : Version :=
  if s.otherCopy.isSome then ⟨edit.forkId, 1⟩
  else ⟨s.current.version.article, s.current.version.generation + 1⟩

def save (r : Auth.Request) (user : Nat) (edit : Edit) (s : State) : Result × State :=
  if canAccess r user edit s then
    if edit.body == s.current.body then (.unchanged, s)
    else if edit.version.article == s.current.version.article &&
        edit.version.generation == s.current.version.generation then
      let version := nextVersion edit s
      (.changed, { s with
        current := ⟨version, edit.body, none⟩
        projectMemoryRevision := s.projectMemoryRevision + 1
        userMemoryRevision := s.userMemoryRevision + (if s.inUserMemory then 1 else 0)
        jobs := version :: s.jobs })
    else (.rejected, s)
  else (.rejected, s)

theorem foreign_stock_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (foreign : s.owner ≠ user) :
    save r user edit s = (.rejected, s) := by
  simp [save, canAccess, foreign]

theorem removed_stock_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (removed : s.present = false) :
    save r user edit s = (.rejected, s) := by
  simp [save, canAccess, removed]

theorem url_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (url : s.textSource = false) :
    save r user edit s = (.rejected, s) := by
  simp [save, canAccess, url]

theorem delegated_edit_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (delegated : r.kind = .token ∨ r.kind = .mcp) :
    save r user edit s = (.rejected, s) := by
  rcases delegated with h | h <;>
    simp [save, canAccess, Auth.apiAllowed, Auth.routeAllowed, Auth.tokenRoute, Auth.mcpRoute, h]

theorem stale_article_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (newBody : edit.body ≠ s.current.body)
    (stale : edit.version.article ≠ s.current.version.article) :
    save r user edit s = (.rejected, s) := by
  simp [save, newBody, stale]

theorem stale_generation_denied (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (newBody : edit.body ≠ s.current.body)
    (stale : edit.version.generation ≠ s.current.version.generation) :
    save r user edit s = (.rejected, s) := by
  simp [save, newBody, stale]

theorem same_body_does_not_write (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (allowed : canAccess r user edit s = true) (same : edit.body = s.current.body) :
    save r user edit s = (.unchanged, s) := by
  simp [save, allowed, same]

theorem shared_edit_changes_only_target (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (allowed : canAccess r user edit s = true) (newBody : edit.body ≠ s.current.body)
    (current : edit.version = s.current.version) (shared : s.otherCopy.isSome = true) :
    let after := (save r user edit s).2
    after.current.version = ⟨edit.forkId, 1⟩ ∧ after.otherCopy = s.otherCopy ∧
      after.stockDetails = s.stockDetails ∧ after.jobs = ⟨edit.forkId, 1⟩ :: s.jobs := by
  simp [save, nextVersion, allowed, newBody, current, shared]

theorem successful_edit_invalidates_memory (r : Auth.Request) (user : Nat) (edit : Edit) (s : State)
    (allowed : canAccess r user edit s = true) (newBody : edit.body ≠ s.current.body)
    (current : edit.version = s.current.version) :
    let after := (save r user edit s).2
    after.current.body = edit.body ∧ after.current.summary = none ∧
      after.projectMemoryRevision = s.projectMemoryRevision + 1 ∧
      after.userMemoryRevision = s.userMemoryRevision + (if s.inUserMemory then 1 else 0) := by
  simp [save, allowed, newBody, current]

def web : Auth.Request := ⟨.session, true, true, true, true, .patch, .stockRead⟩
def before : State := ⟨true, 1, true, ⟨⟨3, 2⟩, 4, some 40⟩, none, 9, 5, 6, false, []⟩
def newText : Edit := ⟨⟨3, 2⟩, 5, true, 20, 6⟩

theorem success_reachable :
    save web 1 newText before =
      (.changed, ⟨true, 1, true, ⟨⟨3, 3⟩, 5, none⟩, none, 9, 6, 6, false, [⟨3, 3⟩]⟩) := by
  decide

theorem rejection_reachable :
    save { web with sameOrigin := false } 1 newText before = (.rejected, before) ∧
    save web 1 { newText with length := 20001 } before = (.rejected, before) ∧
    save web 1 { newText with nonblank := false } before = (.rejected, before) := by
  decide

end Verification.TextStock
