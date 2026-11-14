# NRO Tracker

Progress tracker for New Retail Outlets: PMC enters progress at site (maker), EO reviews (checker), TM gets an overview.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell and styles |
| `landing-bg.jpg` | Background picture of the sign-in page |
| `app.js` | Screens, roles and actions |
| `store.js` | Data layer: Firebase, or demo mode when no config is set |
| `data.js` | 52-activity template, phases, sales groups, districts, settings |
| `firebase-config.js` | Your Firebase web config (empty = demo mode) |
| `firestore.rules`, `storage.rules` | Security rules to paste into the Firebase console |

## Try it first (demo mode)

With `firebase-config.js` left empty the app runs with sample logins (Admin, EO, PMC, TM) and no sites; anything you add is kept only in that browser. It must be served over http, not opened as a file:

    python -m http.server 8000      then open http://localhost:8000

## Firebase setup

1. Firebase console > Add project (for example `nro-tracker-brt`).
2. Build > Authentication > Get started > Sign-in method > enable **Email/Password** (the app uses it behind the User ID login).
3. Build > Firestore Database > Create database > production mode > region `asia-south1` (Mumbai).
4. Build > Storage > Get started (the console will ask for the Blaze plan if the project needs it) > same region.
5. Firestore > Rules: paste `firestore.rules` > Publish.
6. Storage > Rules: paste `storage.rules` > Publish. Accept the prompt that lets Storage rules read Firestore; the rules use it to check each user's role.
7. Project settings > Your apps > Web app (`</>`) > register > copy the `firebaseConfig` values into `firebase-config.js`.

## Publish on GitHub Pages

1. Create a repository and upload `index.html`, `app.js`, `store.js`, `data.js`, `firebase-config.js`, `landing-bg.jpg`.
2. Settings > Pages > deploy from the `main` branch, root folder.
3. Firebase > Authentication > Settings > Authorised domains > add `<your-username>.github.io`.

## Logins: User ID and password

Users sign in with a short User ID and a password. Only the admin creates logins; there is no self-registration.
Behind the scenes each User ID is stored in Firebase Authentication as `<userid>@nro-tracker.local`.

### Create your own admin login (once)

1. Firebase console > Authentication > Users > **Add user**. Email: `admin@nro-tracker.local` (or `<your id>@nro-tracker.local`). Set a password. Copy the **User UID** shown in the list.
2. Firebase console > Firestore > Start collection `users` > Document ID = that User UID, with fields:
   `name` (string) your name, `userId` (string) `admin`, `role` (string) `admin`.
3. Open the app and sign in with User ID `admin` and your password.

### Add everyone else

In the app: **Users > Add user**. Enter name, User ID, a starting password and the role (PMC, EO, TM or Admin). Hand the ID and password to the person. They can change the password themselves with **Change password** after signing in.

### Blocking a user

Users > set the role to **No access**.

### Forgotten password

There is no email reset, because User IDs are not real email addresses.

1. Firebase console > Authentication > find `<userid>@nro-tracker.local` > Delete account.
2. In the app: Users > Add user with the **same User ID** and a new starting password. The app moves that person's site assignments to the new login.

## Adding a site that is already under construction

1. **New NRO**: enter the site details and set **Work start date** to the actual past date, so the day count is right.
2. Open the site > **Activities** > **Enter opening status** (EO or admin).
3. Copy the Status / Remarks column (rows 1 to 52) from your existing Excel sheet, paste it in the box and choose **Fill the table from pasted text**. COMPLETED, YTS, NA and "WIP 90%" are recognised; any other text is kept as the pending item with the row set to In progress.
4. Check the rows, correct any percentage, and save. No photos are needed for this step.
5. Use **Scope** on any activity whose owner differs from the standard CC or DC split.

From then on the PMC makes normal updates with photos.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including user roles and progress entries on any site |
| EO | Create and edit sites, map EO/SO/PMC, change activity scope, issue letters, add standard drawings, add and close MoM points, plan visits, mark PMC entries as reviewed |
| PMC | On assigned sites only: progress updates with photos, check in and out, measurements, MoM points, site drawings, visit plan, draft letters |
| TM | Read everything, change nothing |

PMC entries count immediately; there is no approval step. The EO review mark on the update log is a record only.

## Data structure (Firestore)

- `users/{uid}`: name, userId, role
- `sites/{id}`: site details, EO/SO/PMC mapping, `acts` (status of the 52 activities), `draw` (current drawings and earlier revisions), `plan` (planned visit dates), `updDays`, `visitDays`, `lastPhotos`
- `sites/{id}/updates`: every progress entry (who, when, activity, new status, note, photo, GPS, EO review mark)
- `sites/{id}/visits`: check-in and check-out, GPS, distance from site, persons present, remarks
- `sites/{id}/meas`: measurements against BOQ items
- `sites/{id}/mom`: MoM action points
- `letters`: drafts and issued letters
- `std`: standard drawings

## Files (Storage)

- `sites/{siteId}/photos/{date}/...jpg`: photos, resized to 1600 px and stamped with site, activity, date, time and GPS
- `sites/{siteId}/drawings/{slot}_R{n}.pdf`: site drawings by revision
- `standard-drawings/...pdf`

Photo and drawing links are long unguessable download links. Anyone who is given a link can open that file, so treat them like the files themselves.

## Settings

In `data.js`: target days (60), stalled threshold (5 days), update days per week (3), check-in radius (300 m), letter reference prefix, sales groups, districts, and the activity template.

## Not built yet

- MoM with signature pads and PDF
- Letterhead PDF (letters currently print from the browser)
- RA bill abstract from measurements, BOQ import
- Excel export
- Offline queue for photos when there is no network
