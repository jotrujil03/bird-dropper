# Team Test Plan for Bird Dropper App

## Overview

This document describes how three primary features of the Bird Dropper App will be tested. Each section details:
- **Test Cases**: Specific user acceptance tests, including the user activities and data executed.
- **Test Data**: The sample data used during testing.
- **Test Environment**: The environment in which the tests are executed (localhost or cloud).
- **Expected and Actual Results**: The specific outcomes we expect from the tests and the observed results.
- **User Acceptance Testers**: QA team members.

*The final project report will include detailed observations and actual results recorded during test execution.*

---

## 1. Feature: Home Page Rendering

### Test Case: Verify Home Page Load

- **User Activity**:
  1. Open a web browser.
  2. Navigate to `http://localhost:3000/`.
- **Test Data**: No user input required.
- **Test Environment**: Localhost (development server).
- **Expected Result**:
  - Status code `200 OK`.
  - Page should display the text `Bird Dropper`.
- **Actual Result**:
  - Status `200 OK`.
  - Text `Bird Dropper` was found on the page.
- **User Acceptance Testers**: Development team QA members.

---

## 2. Feature: User Registration

### Test Case: Register a New User and Redirect to Profile

- **User Activity**:
  1. Navigate to the `/register` page.
  2. Fill out the form with valid information.
  3. Submit the form.
- **Test Data**:
  - **First Name**: Test
  - **Last Name**: User
  - **Email**: `test<timestamp>@bird.com` (unique)
  - **Username**: `testuser<timestamp>`
  - **Password**: `Password123`
- **Test Environment**: Localhost (development server).
- **Expected Result**:
  - Status `200 OK` or `302 Redirect`.
  - User is redirected to `/profile`.
- **Actual Result**:
  - Successful registration and redirection to `/profile`.
- **User Acceptance Testers**: QA testers assigned to new user flows.

---

## 3. Feature: Login Failure with Incorrect Credentials

### Test Case: Attempt to Login with Wrong Credentials

- **User Activity**:
  1. Navigate to the `/login` page.
  2. Enter wrong email/password.
  3. Submit the login form.
- **Test Data**:
  - **Email**: `wrong@email.com`
  - **Password**: `wrongpass`
- **Test Environment**: Localhost (development server).
- **Expected Result**:
  - Display an error message saying `Invalid email or password`.
- **Actual Result**:
  - Error message appeared as expected.
- **User Acceptance Testers**: QA testers responsible for authentication flows.

---

## Final Notes

- All tests were executed on the local development server (`localhost`).
- Observed results matched expected results.
- Any deviations found during future testing will be logged for fixes.
- Final testing will also be performed in a cloud-hosted staging environment before production release.

---

## Risks

### Organizational Risks
- Lack of skilled QA team members could delay execution of test cases.
- Limited resources might impact thorough testing if deadlines overlap with other assignments.

### Technical Risks
- Code might have untested edge cases that fail during UAT.
- Limited availability of diverse test data could cause insufficient test coverage.

### Business Risks
- If external factors delay the availability of cloud hosting or server resources, project launch could be delayed.
- Unexpected changes in project requirements by stakeholders could require rework late in the project cycle.
