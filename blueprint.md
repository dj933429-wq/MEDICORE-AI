# MediCore AI - Blueprint

## Overview

MediCore AI is an AI-powered Hospital Management System designed to streamline patient management, appointment scheduling, and pharmacy inventory. It leverages AI to provide smart suggestions, report summarization, and a patient-facing chatbot. The application features a modern, clean, and intuitive user interface, with role-based access control to ensure that users only see the information relevant to them.

## Architecture and Design

*   **Frontend:** Next.js with React (`/app` router)
*   **Styling:** Tailwind CSS
*   **Backend:** Next.js API Routes (planned)
*   **Database:** Firebase Firestore
*   **Authentication:** Firebase Auth (role-based)
*   **AI:** Gemini API (planned)

## Implemented Features

### Core Application Structure
*   **Project Setup:** Next.js project initialized and configured.
*   **Firebase Integration:** Firebase SDK and environment variables are set up.
*   **Styling:** Global styles and Tailwind CSS are configured for a consistent and modern look and feel.

### Authentication
*   **User Signup and Login:** Users can create accounts and log in with email and password.
*   **Role-Based Access Control (RBAC):** Users are assigned roles (Admin, Doctor, Patient) upon registration.
*   **Authentication Context:** A React Context (`AuthProvider`) provides authentication state to the entire application.

### Dashboards
*   **Dynamic Dashboard Routing:** The main dashboard page dynamically renders the appropriate dashboard based on the user's role.
*   **Admin Dashboard:**
    *   Displays a list of all users in the system.
    *   Includes a search functionality to filter users by name or email.
*   **Doctor Dashboard:**
    *   Displays a list of patients assigned to the doctor.
    *   Includes a search functionality to filter patients.
    *   Provides a "View Records" button to navigate to a patient's detailed medical history.
*   **Patient Dashboard:**
    *   Displays the patient's upcoming appointments.
    -   Shows a summary of their medical history.
    *   Includes a button to book a new appointment.

### Patient Management
*   **Patient Detail Page:** A dedicated page to view a patient's complete medical history and personal information.
*   **Add Medical Records:** Doctors can add new medical records to a patient's history through a form on the patient detail page.

## Future Development Plan

### Phase 1: Database Implementation
*   Replace mock data with real-time data from Firebase Firestore.
*   Implement Firestore security rules to ensure data privacy and integrity.
*   Connect the "Add Medical Record" functionality to Firestore.
*   Connect the user list in the Admin Dashboard to Firestore.

### Phase 2: Appointment Management
*   Implement the "Book New Appointment" functionality for patients.
*   Create a calendar view for doctors to see their scheduled appointments.
*   Send appointment confirmation and reminder notifications.

### Phase 3: AI-Powered Features
*   Integrate the Gemini API to create an AI-powered chatbot for patient support.
*   Use AI to summarize patient medical records for doctors.
*   Develop a feature for AI-assisted diagnosis based on reported symptoms.

### Phase 4: Pharmacy and Inventory
*   Create a module for managing the hospital's pharmacy and inventory.
*   Implement low-stock and expiry alerts.
