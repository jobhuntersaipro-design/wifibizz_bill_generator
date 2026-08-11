# Admin Page

## Overview
Create an admin page that normal users cannot login.
The admin page can be login via BIZZFLOW_ADMIN_USERNAME and BIZZFLOW_ADMIN_PWD.

## Requirements
- Revamp the current data model where admin can create/edit/delete the user from User table.
- Admin can set wifibizz_users wifibizz_email but not wifibizz_password.
- After user login, they cannot change wifibizz_email, because this can be only set by Admin. They need to input the wifibizz_password.
- One User can only have one wifibizz_email.

## References
- @context/project-overview.md