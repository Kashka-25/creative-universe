# "I'm interested": the shared form

Every work page in Creative Universe has a short **I'm interested** form (name, email, optional message). All of them post to **one Formspree form**. That form emails **YourOwnUniverse.life@gmail.com**, and each submission can also be filed in **Notion** under its project.

The form is hidden until an endpoint is set, so nothing shows until Cassidy has finished the steps below.

## What each submission carries

| Field | Example |
| --- | --- |
| `name`, `email` | required (so Cassidy can reply) |
| `message` | optional |
| `project` | the work's title, e.g. `Kronk` |
| `page` | the page it was sent from |
| `subject` | `[Kronk] Interest from Sam` (Formspree uses this as the email subject) |
| `_gotcha` | honeypot against spam bots; people never see it |

Code: `src/portfolio/InterestForm.tsx` (the form) and `src/portfolio/interest.ts` (endpoint check, subject, payload; tested in `tests/interest.test.ts`). Styles: `src/styles/interest.css`.

## Steps only Cassidy can do

1. **Formspree:** create an account at formspree.io and a new form. Set its email to YourOwnUniverse.life@gmail.com and confirm the address. Copy the form's endpoint (`https://formspree.io/f/<id>`).
2. **Endpoint:** paste it into `content/interest.json` as `"endpoint"` (or send it to the master session). The build accepts only a `https://formspree.io/f/<id>` address.
3. **Notion:** choose a route (below) and connect it in Formspree.
4. **Gmail:** add the filters below.
5. **Test:** send one form from one page. It should land in Gmail under the right label and, with Notion connected, as a new row.

## Getting submissions into Notion

Checked on Formspree's help pages, 9 Nov 2026. Confirm prices at checkout, because their pages showed two different sets.

| Route | Plan needed | Cost (USD/month) | Notes |
| --- | --- | --- | --- |
| **Formspree's Notion plugin** (recommended) | Personal or higher | about $10–15 | Built in: creates a database under the Notion page you pick, one row per submission. Turn on "Workflow" in Formspree's labs settings first. |
| Zapier or webhooks | Professional or higher | about $20–30, plus Zapier's own plan | Only if more control is needed later. |
| Email only | Free (50 submissions a month) | $0 | No automatic Notion rows. Gmail labels still sort everything, and Cassidy can copy interest into Notion by hand. |

After the plugin creates the Notion database, add two columns by hand:
- **Status:** a select with New, Replied, Invited and Not now.
- **Received:** a "Created time" column, if the plugin doesn't add a date.

The `project` field gives each row its project.

## Gmail filters (one label per project)

In Gmail, go to Settings, then Filters and blocked addresses, then Create a new filter. For each row below, put the text in **Subject**, then choose **Apply the label**, using a new label of that name.

| Subject contains | Label |
| --- | --- |
| `[YOU]` | Interest/YOU |
| `[YOUrigin]` | Interest/YOUrigin |
| `[CommYOUnity]` | Interest/CommYOUnity |
| `[Wandering]` | Interest/Wandering |
| `[Atlantean Gardens]` | Interest/Atlantean Gardens |
| `[Hopeium]` | Interest/IntoTheLighthouse |
| `[Empatherapy]` | Interest/Empatherapy |
| `[FreeTheDream]` | Interest/FreeTheDream |
| `[Kronk]` | Interest/Kronk |
| `[Wachuneed]` | Interest/Kronk |
| `[My Living YOUlogy]` | Interest/Music |
| `[Sweet Vital Nectar]` | Interest/Sweet Vital Nectar |
| `[Chantilly's Tallow]` | Interest/Client work |
| `[ReFocus Counselling]` | Interest/Client work |

A filter with only `Interest from` in the Subject and the label **Interest** catches all of them.

The subject uses the work's title as it appears on the site. If a title changes, for example Hopeium becoming IntoTheLighthouse, update its filter.
