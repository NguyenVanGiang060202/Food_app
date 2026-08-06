# NoN? Platform - Project Overview

## 1. Project Name

NoN? Platform

## 2. Project Purpose

This project is a food discovery application that helps users find restaurants, dishes, and food experiences based on collected real-world data.

The system collects data from multiple external sources, stores and processes the data, then provides users with search, recommendation, and discovery features.

The application is designed to scale from a simple restaurant discovery app into an intelligent food recommendation platform.

---

## 3. Main Goals

### Primary Goals

- Collect restaurant and food information automatically.
- Store structured restaurant data in a database.
- Provide fast search and filtering.
- Recommend restaurants based on user preferences.
- Aggregate information from multiple platforms.
- Build a scalable data pipeline.

---

## 4. Core Features

### Restaurant Discovery

Users can:

- Search restaurants.
- Browse restaurants by category.
- View restaurant details.
- View images.
- View reviews.
- View ratings.
- Find nearby restaurants.

---

### Food Data Aggregation

The system collects:

- Restaurant name.
- Address.
- Location.
- Opening hours.
- Price range.
- Food categories.
- Images.
- Reviews.
- Social media information.
- ???c g?i nhi?u dishes.

---

### Intelligent Recommendation

Future AI features:

- Recommend restaurants based on user behavior.
- Recommend dishes based on preferences.
- Personalized food discovery.
- Trend detection.
- Food popularity analysis.

---

## 5. System Philosophy

This project is data-first.

The priority order:

1. Data collection.
2. Data cleaning.
3. Data storage.
4. API layer.
5. User interface.
6. AI recommendation.

The frontend is only a visualization layer.

The quality of the application depends mainly on:

- Data quality.
- Database structure.
- Processing pipeline.

---

## 6. High-Level Data Flow

```text
External Sources

Google Maps
TikTok
Facebook
Food Websites
Review Platforms

    |
    v

Crawler System

    |
    v

Data Processing

    |
    v

Database

    |
    v

Backend API

    |
    v

Frontend Application

    |
    v

Users
```

---

## 7. Project Principles

### Scalability

The architecture must allow:

- Adding new crawlers.
- Adding new data sources.
- Supporting millions of restaurants.
- Supporting AI features.

---

### Maintainability

Code must be:

- Modular.
- Documented.
- Easy to extend.

---

### Cost Optimization

The system should prioritize free or low-cost technologies.

Preferred solutions:

- Open source tools.
- Free database tiers.
- Self-hostable services.

---

## 8. Development Strategy

Development is divided into phases.

### Phase 1 - Foundation

Create:

- Project structure.
- Database design.
- Backend foundation.
- Basic crawler framework.

---

### Phase 2 - Data Collection

Implement:

- Restaurant crawler.
- Data cleaning.
- Database storage.

---

### Phase 3 - Application

Implement:

- Frontend.
- Search.
- Restaurant pages.
- User features.

---

### Phase 4 - Intelligence

Implement:

- Recommendation engine.
- AI analysis.
- Personalized experience.

---

## 9. AI Agent Instructions

When working on this project:

- Always read documentation inside /docs first.
- Do not create code that conflicts with architecture.
- Do not replace existing architecture without approval.
- Prefer scalable solutions.
- Keep components modular.
- Separate frontend, backend, crawler, and database responsibilities.
