# Diagrams

Mermaid diagrams are fenced blocks with the `mermaid` language. The preview renders them; the file
keeps the source.

## Flowchart

```mermaid
flowchart TD
  A[Open a file] --> B{Edit}
  B -->|rich text| C[Preview updates]
  B -->|Markdown| D[Raw source]
  C --> E[Commit]
  D --> E
  E --> F[GitHub]
```

## Sequence

```mermaid
sequenceDiagram
  participant You
  participant mdpad
  participant GitHub
  You->>mdpad: Open the file
  mdpad->>GitHub: GET contents
  GitHub-->>mdpad: text + sha
  mdpad-->>You: Preview
  You->>mdpad: Commit
  mdpad->>GitHub: PUT contents + sha
  GitHub-->>mdpad: new sha
```

## Class

```mermaid
classDiagram
  class Document {
    +string path
    +string text
    +string sha
  }
  class Session {
    +string owner
    +string repo
    +string branch
  }
  Session "1" --> "*" Document
```

## State

```mermaid
stateDiagram-v2
  [*] --> Clean
  Clean --> Dirty: edit
  Dirty --> Clean: commit
  Dirty --> Clean: reload
  Clean --> [*]
```

## Pie

```mermaid
pie title Where the time goes
  "Reading" : 40
  "Writing" : 35
  "Editing" : 25
```

## Gantt

```mermaid
gantt
  title A small release
  dateFormat YYYY-MM-DD
  section Build
  Editor        :a1, 2026-01-05, 10d
  Docs          :a2, after a1, 5d
  section Ship
  Review        :b1, after a2, 3d
  Release       :b2, after b1, 1d
```

## A broken diagram

A syntax error shows the source instead of an empty box:

```mermaid
flowchart TD
  A[ --> B[
```

## Notes

- The language tag must be exactly `mermaid`.
- Diagrams are rendered lazily: the page loads first, the diagram follows.
- Click a diagram to open it larger.
