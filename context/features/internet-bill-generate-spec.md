# Internet Bill Generation

## Overview

All user to generate bill based on case list

## Requirements
- Add a button below search bar named "Generate Internet Bill", then it should run the script @generate-utility-bill.py
- Create upload API route for R2
- Delete files from R2 when items are deleted
- Create download proxy API route (avoids CORS issues)
- Display image preview for generated bill in slide-in modal
- The generated Internet bill file should link to R2
- Allow users to select all from current case list table
- Allow users to select one by one of case list table
- In each row, there should be new 2 buttons
    1. Internet bill button (replace the text with internet bill icon)
    2. Utility bill button (replace the text with utility bill icon)
  The 2 buttons should allow users to download the generated bills. If the files is not generated, grey out.
