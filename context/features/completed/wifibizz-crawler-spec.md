# Wifibizz Crawler

## Overview
User should be able to set WifiBizz login credentials on the setting page.
Right now it's reading from .env which is WIFIBIZZ_EMAIL and WIFIBIZZ_PASSWORD. This is temporarily. We should store it in wifibizz_users table

## Requirements
- In settings page, user are required to set wifibizz email and password.
- When click new crawl, the @crawler/scraper.ts will read the values and start crawling
- The data will be loaded into wifibizz_cases
- Main dashboard should show the table from wifibizz_cases with all relevant column, this should be pagination with 10/page
- A search bar with fuzzy search function should be on top of the table

## References
- @context/project-overview.md