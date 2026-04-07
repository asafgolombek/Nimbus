---
name: Connector / Extension Request
about: Request a new MCP connector for a cloud service or third-party integration
title: "connector: "
labels: ["connector", "needs-triage"]
assignees: []
---

## Service

<!-- What service should this connector support? e.g. Notion, Dropbox, Slack, GitHub -->

**Service name:**
**Service website:**
**API / developer docs:**

## Use Cases

<!-- What would you want Nimbus to do with this service? Give 2–3 concrete examples. -->

1. 
2. 
3. 

## API / Auth Model

<!-- What authentication does the service use? Does it have a public API? Any known rate limits or restrictions? -->

- Auth type: <!-- OAuth 2.0 / API key / other -->
- API availability: <!-- Public / beta / requires approval -->
- Relevant API scopes needed: 
- Known rate limits: 

## Read vs. Write Operations

<!-- Which operations would the connector need? Write/delete operations will require HITL consent. -->

**Read (index / search):**
- [ ] List files / items
- [ ] Read file content
- [ ] Search
- [ ] Other: _______________

**Write (requires HITL consent gate):**
- [ ] Create
- [ ] Update / rename
- [ ] Delete
- [ ] Send / publish
- [ ] Other: _______________

## Existing SDK / Libraries

<!-- Are there existing npm packages for this service's API that could be used? -->

## Are You Willing to Build This?

- [ ] Yes — I want to build it and would like guidance
- [ ] Possibly — depends on complexity
- [ ] No — requesting for someone else to build

## Additional Context

<!-- Related issues, prior art, anything else that helps prioritise or scope this. -->
