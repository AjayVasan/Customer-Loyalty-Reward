# Retail Industry - Omni-Channel Customer Loyalty & Rewards Management

**Duration:** 5 Days
**Topics:** SAP BTP CAPM, UI5

---

## Business Scenario

Retailers operate both e-commerce and physical outlets, and customers expect a unified rewards system.

This system will track purchases from all channels, dynamically assign loyalty points, and handle redemptions ensuring points don't go below zero.

---

## Objective

To develop a Loyalty and Rewards Management System that integrates online and in-store customer transactions, computes points dynamically and allows redemption through multiple channels.

---

## Key Features

| Role | Functionality |
|------|--------------|
| Customer | View points, redeem for discounts, track purchase history |
| Retail Staff | Record new purchases (POS or Online) |
| Admin | Define and modify reward policies (e.g., ₹1 = 0.05 points) |

---

## Domain Modelling

### Customer Entity

| Attribute | Data Type | Key | Description |
|-----------|-----------|-----|-------------|
| customerID | UUID | Primary Key | Unique identifier for each customer |
| name | String | | Customer's full name |
| email | String | | Customer's email address |
| totalPoints | Integer | | Total loyalty points accumulated by the customer |
| tier | String | | Customer's loyalty tier (e.g., Bronze, Silver, Gold) |

### Transaction Entity

| Attribute | Data Type | Key | Description |
|-----------|-----------|-----|-------------|
| txnID | UUID | Primary Key | Unique identifier for each transaction |
| customerID | Association to Customer | | Links the transaction to a specific customer |
| channel | String | | Indicates the purchase mode — "Online" or "Store" |
| amount | Decimal(10,2) | | Total amount spent in the transaction |
| txnDate | DateTime | | Date and time when the transaction occurred |
| pointsEarned | Integer | | Loyalty points earned from this transaction |

### Redemption Entity

| Attribute | Data Type | Key | Description |
|-----------|-----------|-----|-------------|
| redeemID | UUID | Primary Key | Unique identifier for each redemption record |
| customerID | Association to Customer | | Identifies which customer redeemed the points |
| pointsUsed | Integer | | Number of loyalty points used for redemption |
| redeemDate | DateTime | | Date and time when the redemption occurred |
| remarks | String | | Notes or comments about the redemption (e.g., reward item, offer details) |

---

## Explanation of Handler Logic

- **Automatically calculates loyalty points based on purchase channel.**
  - *Business Reason:* Reward customers more for online orders to promote digital adoption.

- **Validates that the user has enough points.**
  - *Business Reason:* Prevents over-redemption and ensures database consistency.

- **Deducts used points post successful redemption.**
  - *Business Reason:* Keeps the customer's point balance accurate.

---

## Agile Delivery Plan

| Sprint | Deliverable |
|--------|-------------|
| Sprint 1 | Entity model, mock data, service definitions |
| Sprint 2 | Point computation & redemption logic |
| Sprint 3 | Fiori dashboard for customer & admin |
| Sprint 4 | Deployment & system testing |

---

## Learning Outcome

- Understand end-to-end app flow: Data modeling → Service layer → Handler logic → UI → Deployment.
- Learn how CAP event handlers implement business rules cleanly and securely.
- Gain practical exposure to Fiori UI5 CRUD patterns and data binding.
- Apply Agile principles to structure and deliver a working solution.

---

## Expected Deliverables

| Deliverable | Description |
|-------------|-------------|
| Project Overview Document | Contains objective, scope, and high level flow diagram. |
| Data Model Design | Entity details showing Customer, Transaction, and Redemption entities and their relationships. |
| Service Definition | CAP service file (.cds) listing exposed entities and operations. |
| Agile Sprint Plan | 2–3 sprint breakdown with user stories and acceptance criteria. |
| Test Case Sheet | Test scenarios for each functionality (CRUD, points logic, redemption validation). |
| Deployment Steps | Step-by-step guide for deploying to SAP BTP Cloud Foundry. |

---

> **Important Note:** Implement the solution using both BAS and Build Code. Submit the prompts used in Build Code, and ensure the application is executed to display the output.
