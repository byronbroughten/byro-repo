---
name: code-style
description: Load the code style rules, config's and the framework's, before writing or editing TypeScript, tests, hooks and scripts included.
allowed-tools: Bash(npm run doc:sections *)
---

The code rules from [config's style doc](../../../config/docs/code-style.md), their home:

!`npm run doc:sections -- config/docs/code-style.md "Class shape" Naming Comments "Error handling & validation" "Type modeling" "Functional vs. imperative idioms" Smells Tests Tooling "Imports & file organization"`

The framework's rules, which layer on them for framework and app code, from [the framework style doc](../../../packages/framework/docs/code-style.md):

!`npm run doc:sections -- packages/framework/docs/code-style.md "Class shape" Naming Comments "Error handling & validation" "Type modeling" "Where for…in appears" "Caller-less public members" Tests Tooling "Imports & file organization"`
