# Event Review and Approval — User Stories

**Project:** SCRUM (IS212-G1T5)  
**Total Stories:** 9  
**Export Date:** 2026-10-03  

---

## Overview Table

| Key | Summary | Status | Priority | Story Points | Assignee |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [SCRUM-22](https://is212-g1t5.atlassian.net/browse/SCRUM-22) | [Event Review and Approval] — View and Find Submitted Event Requests | To Do | Low | — | Jerome Liau Jun Rong |
| [SCRUM-23](https://is212-g1t5.atlassian.net/browse/SCRUM-23) | [Event Review and Approval] — View Submitted Event Request Details | In Progress | Medium | 3.0 | Jerome Liau Jun Rong |
| [SCRUM-24](https://is212-g1t5.atlassian.net/browse/SCRUM-24) | [Event Review and Approval] — Approve or Reject Submitted Event Request | In Progress | Medium | 3.0 | Jerome Liau Jun Rong |
| [SCRUM-25](https://is212-g1t5.atlassian.net/browse/SCRUM-25) | [Event Review and Approval] — Add and View Comments | In Progress | Medium | 3.0 | Jerome Liau Jun Rong |
| [SCRUM-26](https://is212-g1t5.atlassian.net/browse/SCRUM-26) | [Event Review and Approval] — Reply to Comments | In Progress | Medium | 5.0 | Jerome Liau Jun Rong |
| [SCRUM-27](https://is212-g1t5.atlassian.net/browse/SCRUM-27) | [Event Review and Approval] — Mention Users in Comments | In Progress | Medium | 5.0 | Jerome Liau Jun Rong |
| [SCRUM-28](https://is212-g1t5.atlassian.net/browse/SCRUM-28) | [Event Review and Approval] — Attach Files to Comments | In Progress | Medium | 5.0 | Jerome Liau Jun Rong |
| [SCRUM-44](https://is212-g1t5.atlassian.net/browse/SCRUM-44) | [Event Review and Approval] — View Event Request Review Outcome | In Progress | Medium | 3.0 | Jerome Liau Jun Rong |
| [SCRUM-45](https://is212-g1t5.atlassian.net/browse/SCRUM-45) | [Event Review and Approval] — Start Reviewing an Event Request | In Progress | Medium | 3.0 | Jerome Liau Jun Rong |

---

## Detailed User Stories

### 1. [SCRUM-22](https://is212-g1t5.atlassian.net/browse/SCRUM-22): View and Find Submitted Event Requests

- **Issue Key:** SCRUM-22
- **Issue Type:** Story
- **Status:** To Do
- **Priority:** Low
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** view, search, and filter submitted event requests,  
> **So that** I can quickly identify the requests that require my attention and begin assessing whether ConnectSphere can support them.

#### Acceptance Criteria
* **AC1 — View submitted requests:**
  * Given I am logged in as an Event Coordinator,
  * When I navigate to the submitted event requests page,
  * Then I can see a list of event requests containing:
    * Event organiser name
    * Event name
    * Submission date
    * Current status
* **AC2 — Default request visibility:**
  * Given I am an Event Coordinator,
  * When I open the submitted event requests page,
  * Then requests assigned to me are shown by default.
  * And if my role has the **"View Unassigned Requests" permission**, unassigned requests are also shown.
  * And requests assigned to other Event Coordinators are not shown unless my role has permission to view all requests.
* **AC3 — Search requests:**
  * Given I am viewing submitted event requests,
  * When I enter an event organiser name or event name into the search field,
  * Then only requests matching the search criteria are displayed.
* **AC4 — Filter by status:**
  * Given I am viewing submitted event requests,
  * When I select one or more statuses,
  * Then only requests with the selected status(es) are displayed.
* **AC5 — Filter by submission date:**
  * Given I am viewing submitted event requests,
  * When I specify a submission date range,
  * Then only requests submitted within that date range are displayed.
* **AC6 — Combine search and filters:**
  * Given I have entered a search term and/or selected multiple filters,
  * When the criteria are applied,
  * Then only requests satisfying all applicable criteria are displayed.
* **AC7 — No matching requests:**
  * Given my search or filters return no matching requests,
  * When the results are displayed,
  * Then I see a clear message indicating that no requests match the selected criteria.

---

### 2. [SCRUM-23](https://is212-g1t5.atlassian.net/browse/SCRUM-23): View Submitted Event Request Details

- **Issue Key:** SCRUM-23
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 3.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** view the full details of a submitted event request,  
> **So that** I can understand the organiser's requirements and assess whether ConnectSphere can support the event.

#### Acceptance Criteria
* **AC1 — Open a request:**
  * Given I can access a submitted event request,
  * When I select the request from the submitted requests list,
  * Then the full details of that request are displayed.
* **AC2 — View event details:**
  * Given I have opened a submitted event request,
  * Then I can view:
    * Event organiser name
    * Event name
    * Event purpose
    * Preferred date and time
    * Expected number of attendees
    * Layout preferences
    * Accessibility needs
    * Equipment needs
    * Submission date
    * Current status
* **AC3 — Missing optional information:**
  * Given an organiser did not provide information for an optional field,
  * When I view the request,
  * Then the field clearly indicates that no information was provided rather than displaying incorrect or misleading information.
* **AC4 — Access control:**
  * Given I do not have permission to view a particular request,
  * When I attempt to access that request,
  * Then I am prevented from viewing its details.

---

### 3. [SCRUM-24](https://is212-g1t5.atlassian.net/browse/SCRUM-24): Approve or Reject Submitted Event Request

- **Issue Key:** SCRUM-24
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 3.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** approve or reject a submitted event request after reviewing its details,  
> **So that** the organiser can be informed whether ConnectSphere can support their event.

#### Acceptance Criteria
* **AC1 — Approve a request:**
  * Given I am viewing a submitted request that I am authorised to review,
  * When I approve the request,
  * Then its status is updated to **Approved**.
* **AC2 — Reject a request:**
  * Given I am viewing a submitted request that I am authorised to review,
  * When I choose to reject the request,
  * Then I am required to provide a reason for rejection before confirming the decision.
  * And when the rejection is confirmed,
  * Then the request status is updated to **Rejected**.
* **AC3 — Confirm decision:**
  * Given I choose to approve or reject a request,
  * When I initiate the action,
  * Then I am asked to confirm the decision before the request status is changed.
* **AC4 — Persist status:**
  * Given a request has been approved or rejected,
  * When I return to the submitted requests list or reopen the request,
  * Then the updated status is displayed.
* **AC5 — Authorisation:**
  * Given I do not have permission to approve or reject a request,
  * When I view the request,
  * Then approval and rejection actions are not available to me.

---

### 4. [SCRUM-25](https://is212-g1t5.atlassian.net/browse/SCRUM-25): Add and View Comments

- **Issue Key:** SCRUM-25
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 3.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** add and view comments on a submitted event request,  
> **So that** I can clarify request details with the event organiser and authorised staff.

#### Acceptance Criteria
* **AC1 — Add a comment:**
  * Given I am authorised to comment on an event request,
  * When I enter a comment and submit it,
  * Then the comment is added to the request.
* **AC2 — Display comment details:**
  * Given a comment has been successfully submitted,
  * When it appears in the comment history,
  * Then it displays:
    * Commenter's name
    * Date and time submitted
    * Comment text
* **AC3 — View comment history:**
  * Given a request contains multiple comments,
  * When I view the comment history,
  * Then the comments are displayed from oldest to newest based on their submission timestamps.
* **AC4 — Prevent empty comments:**
  * Given I have not entered any text,
  * When I attempt to submit a comment,
  * Then it is not submitted and I am visually informed that text is required.
* **AC5 — Comment permissions:**
  * Given I can view a request but do not have permission to participate in the conversation,
  * When I view the request,
  * Then I can view the comments I am authorised to see but the option to add comments is disabled or hidden.

---

### 5. [SCRUM-26](https://is212-g1t5.atlassian.net/browse/SCRUM-26): Reply to Comments

- **Issue Key:** SCRUM-26
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 5.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** reply directly to specific comments on an event request,  
> **So that** I can respond to specific questions without losing the context of the broader conversation.

#### Acceptance Criteria
* **AC1 — Reply to a comment:**
  * Given I am authorised to comment on the request,
  * When I select "Reply" on an existing comment, enter text, and submit,
  * Then the reply is successfully saved and associated with the parent comment.
* **AC2 — Display reply details and visual hierarchy:**
  * Given a comment has one or more replies,
  * When I view the conversation,
  * Then each reply displays the author's name, timestamp, and text,
  * And the reply is visually indented or nested to show it is a child of the original comment.
* **AC3 — Order replies:**
  * Given a comment contains multiple replies,
  * When I view the replies within that thread,
  * Then they are displayed from oldest to newest based on their submission timestamps.
* **AC4 — Prevent empty replies:**
  * Given I have not entered any text in the reply field,
  * When I attempt to submit the reply,
  * Then it is not submitted and I am visually informed that text is required.

---

### 6. [SCRUM-27](https://is212-g1t5.atlassian.net/browse/SCRUM-27): Mention Users in Comments

- **Issue Key:** SCRUM-27
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 5.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** mention relevant users in comments and replies,  
> **So that** I can directly alert them to specific questions or information related to an event request.

#### Acceptance Criteria
* **AC1 — Search for users:**
  * Given I am writing a comment,
  * When I enter "@" followed by a name,
  * Then I am shown matching users eligible to access the request.
* **AC2 — Add a mention:**
  * Given matching users are displayed,
  * When I select a user,
  * Then the user is added as a mention within my text.
* **AC3 — Display mentions:**
  * Given a submitted comment contains a mention,
  * When the conversation is displayed,
  * Then the user's name is visually distinct.
* **AC4 — Notification Trigger:**
  * Given I successfully submit a comment containing a user mention,
  * When the comment is saved,
  * Then the system triggers an immediate notification (e.g., email or in-app alert) to the mentioned user containing a link to the comment.
* **AC5 — Restrict mentions:**
  * Given a user is not authorised to access the event request,
  * When I search for users to mention,
  * Then that user is not available for selection.

---

### 7. [SCRUM-28](https://is212-g1t5.atlassian.net/browse/SCRUM-28): Attach Files to Comments

- **Issue Key:** SCRUM-28
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 5.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** attach one or more supporting files to comments on an event request,  
> **So that** I can share additional information that helps clarify or assess the request.

#### Acceptance Criteria
* **AC1 — Attach multiple files:**
  * Given I am writing a comment or reply,
  * When I select one or more supported files,
  * Then the files are staged to be attached before I submit.
* **AC2 — Display attachments:**
  * Given a comment contains attachments,
  * When I view the conversation,
  * Then I can see the attachments and their file names.
* **AC3 — Access attachments:**
  * Given I am authorised to access the event request,
  * When I select an attachment,
  * Then I can open or download it.
* **AC4 — Supported file types:**
  * Given I select a supported image, video, or document file,
  * When the file is attached,
  * Then it is accepted by the system.
* **AC5 — Unsupported file type:**
  * Given I select an unsupported file type,
  * When I attempt to attach it,
  * Then it is rejected and I am informed the file type is not supported.
* **AC6 — File size validation:**
  * Given I select a file exceeding the maximum size,
  * When I attempt to attach it,
  * Then it is rejected and I am informed it exceeds the allowed size.

---

### 8. [SCRUM-44](https://is212-g1t5.atlassian.net/browse/SCRUM-44): View Event Request Review Outcome

- **Issue Key:** SCRUM-44
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 3.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Organiser,  
> **I want to** view the outcome of my submitted event request,  
> **So that** I know whether the request has been approved or rejected and what I should do next.

#### Acceptance Criteria
* **AC1 — View approved outcome:**
  * Given my event request has been approved,
  * When I view the request,
  * Then I can clearly see that its status is **Approved**.
* **AC2 — View rejected outcome:**
  * Given my event request has been rejected,
  * When I view the request,
  * Then I can clearly see that its status is **Rejected**.
* **AC3 — View rejection reason:**
  * Given my event request has been rejected,
  * When I view the review outcome,
  * Then I can see the reason provided by the Event Coordinator.
* **AC4 — Display decision information:**
  * Given a final review decision has been made,
  * When I view the outcome,
  * Then I can see:
    * Review outcome
    * Date and time of decision
    * Relevant reason or comments where applicable
* **AC5 — No final decision:**
  * Given my event request is still being reviewed,
  * When I view the request,
  * Then the system does not incorrectly display it as approved or rejected.
* **AC6 — Access control:**
  * Given I am not assigned event coordinate, I am unable to view the event request,
  * When I attempt to access its review outcome,
  * Then I am prevented from viewing it.

---

### 9. [SCRUM-45](https://is212-g1t5.atlassian.net/browse/SCRUM-45): Start Reviewing an Event Request

- **Issue Key:** SCRUM-45
- **Issue Type:** Story
- **Status:** In Progress
- **Priority:** Medium
- **Story Points:** 3.0
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong
- **Sprint:** SCRUM Sprint 1, SCRUM Sprint 2

#### User Story
> **As an** Event Coordinator,  
> **I want to** start reviewing a submitted event request,  
> **So that** other relevant users can see that the request is currently being assessed.

#### Acceptance Criteria
* **AC1 — Start review:**
  * Given I am assigned to a submitted event request,
  * And I am authorised to review it,
  * When I choose to start the review,
  * Then the request status changes from **Submitted** to **Under Review**.
* **AC2 — Display updated status:**
  * Given I have started reviewing a request,
  * When an authorised user views the request,
  * Then its current status is displayed as **Under Review**.
* **AC3 — Prevent invalid review:**
  * Given a request is not in a status that allows review to begin,
  * When I view the request,
  * Then the Start Review action is not available.
* **AC4 — Record status change:**
  * Given a review has started successfully,
  * Then the system records:
    * The coordinator who started the review
    * Previous status
    * New status
    * Date and time of the change
* **AC5 — Authorisation:**
  * Given I am not authorised to review the request,
  * When I view it,
  * Then I cannot start the review.
