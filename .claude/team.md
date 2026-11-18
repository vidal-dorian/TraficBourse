---
steps:
  - agent: test-writer
    does: "writes the failing acceptance tests from the criteria"
  - agent: developer
    does: "implements until the tests pass, without touching them"
  - agent: reviewer
    does: "reviews the diff with a fresh context"
    loop_to: developer
    until: "the verdict is ready"
  - agent: security-reviewer
    does: "reviews the diff of the story for security"
    loop_to: developer
    until: "the verdict is ready"
  - agent: doc-writer
    does: "updates the documentation the change reaches"
  - agent: doc-reviewer
    does: "reviews the documentation diff only"
    loop_to: doc-writer
    until: "the verdict is ready"
---
