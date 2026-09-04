# Storm Dialer — Clean Build

This is a clean Node/Express deployment for Bandwidth Programmable Voice.

## Render
Build command:
`npm install`

Start command:
`npm start`

## Environment variables
Add these exact names in Render:
- BW_ACCOUNT_ID
- BW_APPLICATION_ID
- BW_NUMBER
- BW_CLIENT_ID
- BW_CLIENT_SECRET
- BASE_URL
- AGENT_NUMBER

Do not put the Client ID in a variable called BW_USERNAME in this clean build.

## First test
After deployment, open:
`https://YOUR-SERVICE.onrender.com/debug/auth`

Expected:
`{"ok":true,...}`

If it says `invalid_client`, stop there: the failure is the Bandwidth credential pair, not the dialer.

## Calling
Enter E.164 numbers such as `+12125550101`. When a called lead answers, the call is transferred to AGENT_NUMBER.

Only call people you are authorized to contact and comply with applicable telemarketing, consent, do-not-call, caller-ID, and abandoned-call rules.
