# Launch pack — AI Stock Analyzer

Written for the 3.0 release. **Do not post anything until 3.0 is live in the store** —
the published build is still an early 2.8 and is missing the earnings calendar, the AI
portfolio review, the daily digest and the French notifications. A launch that sends
people to the old build spends the one first impression you get.

---

## 1. Where you can post, and where it is a permanent ban

I could not read the subreddit rule pages directly (Reddit is blocked from this
machine), so this is from Reddit's published policy and current write-ups. **Open each
sidebar and re-read the rules the day you post** — mods change them, and the cost of
being wrong is asymmetric.

### Closed — do not post, no exceptions

| Subreddit | Why |
|---|---|
| r/investing | Self-promotion is an **automatic permanent ban**. Apps and tools are named explicitly. |
| r/stocks | Same policy family. No tools, no apps. |
| r/wallstreetbets | "No self-promotion" is a standing rule. |
| r/algotrading, r/ValueInvesting | Strict; tool posts get removed. |

These are where your users are, and they are shut. Accept it. The damage from forcing
it is not one removed post — repeated attempts can get **chromewebstore.google.com
links from your domain filtered site-wide**, which would block even a stranger from
recommending you. At 9 users that asset is worth more than any single post.

The only legitimate door into finance communities is the 90/10 rule: be a real
participant for weeks, answer questions, and mention the tool only when someone asks
what you use. That is a slow play, not a launch.

### Open — post here

| Venue | Notes |
|---|---|
| **r/SideProject** | The friendliest. Lead with the build story, be honest about numbers. Pure product-page posts get removed. |
| **r/chrome_extensions** | ~43k, largely self-promo by design, so it is allowed — but traffic is modest. Treat as a dev audience. |
| **Show HN** (news.ycombinator.com) | Technical, blunt, allergic to marketing. Highest quality feedback. |
| **Product Hunt** | Needs the assets ready; one shot per product. |
| **r/webdev, r/learnprogramming** | Only inside their scheduled showcase threads. Check the pinned post. |
| Subs with a **weekly self-promo thread** | e.g. r/financialindependence (Wednesdays). Allowed only inside the thread. |

### Sequence

Do not post everywhere on one day — Reddit flags that pattern. One venue, then read the
comments for a day, fix what people complain about, then the next. Roughly:

1. Day 1 — r/SideProject
2. Day 3 — r/chrome_extensions
3. Day 5 — Show HN
4. Later — Product Hunt, once the first three have shaken out the obvious complaints

Post mid-morning US Eastern on a weekday. 85% of your installs are already US.

---

## 2. The angle

Do not lead with "AI analyzer". Every third extension says that, and it reads as
marketing. Lead with the annoyance it removes.

> ❌ "I built an AI-powered stock analyzer, check it out"
> ✅ "I was tired of opening a new tab every time a ticker showed up in a thread"

Your genuinely unusual bits, in order of how much people care:

1. **It works where you already read** — highlights tickers on finance sites *and on
   Reddit/X*, hover for a price, click for the full breakdown.
2. **No API keys, no account, no paywall.** Almost every competitor asks for one of the
   three. Say it plainly once; do not repeat it like a slogan.
3. **Multi-currency portfolio from a broker CSV.** Mixed CAD/USD holdings valued
   correctly instead of showing a fake FX loss. Niche, but the people it hits have been
   burned by every other tracker.
4. **Reddit hype signal per ticker** — mentions and trend direction. On Reddit this is
   the part that makes people curious, because it is about them.

---

## 3. Post drafts

### r/SideProject

Self-post. **Put the store link in your first comment, not the body.**

> **Title:** I got tired of opening a new tab for every ticker in a thread, so I built an extension that explains them in place
>
> I read a lot of finance threads and kept doing the same loop: see `$GMIN`, don't
> recognise it, open Yahoo, squint at it, come back, lose the thread.
>
> So I built a Chrome extension that highlights tickers on the page — finance sites,
> Reddit and X included. Hover one for a live price, click for a full breakdown:
> what the company does, sector, risk, analyst consensus, upcoming earnings, and an
> AI verdict. There is also a portfolio tab that imports a broker CSV, which is the
> part I actually use daily.
>
> Things I got wrong along the way, in case it saves someone time:
>
> - Small foreign tickers are miserable. `SAU` is only real as `SAU.TO` and my data
>   provider's free tier is US-only, so I ended up probing six exchange suffixes in
>   parallel. Then that broke whenever Yahoo throttled me, so now resolved symbols are
>   cached at the edge for 30 days.
> - Mixed-currency portfolios silently lied. A Toronto listing is priced in CAD; I was
>   summing it as USD and showing people a loss that did not exist.
> - My AI provider deprecated both models I used, with no warning, and the analysis
>   endpoint was simply dead in production until I noticed.
>
> It is free, no account, no API keys — a free backend tier covers it, and if that ever
> stops being true I will say so rather than quietly adding a paywall.
>
> Honest numbers: 9 active users. I have spent far more time on the code than on
> telling anyone it exists, which is why I am here.
>
> What I would like feedback on: the first-run experience. I think it is unclear what
> to do in the first ten seconds and I am too close to it to see why.

**First comment:** `Store link: https://chromewebstore.google.com/detail/gmildjlnkoljdenbocapnkpllgkdombk — source is open if anyone wants to pick it apart: https://github.com/mrignis/ai-stock-analyzer`

---

### r/chrome_extensions

Dev audience — lead with the build, not the pitch.

> **Title:** MV3 extension with no API keys for the user — everything proxied through a free Cloudflare Worker
>
> Sharing the architecture because the "how do I ship an extension that needs API keys
> without asking users for API keys" question comes up here a lot.
>
> The extension analyzes stock tickers: highlights them on finance sites and on
> Reddit/X, hover for a live price, click for a full AI breakdown. The constraint I set
> was that a user should install it and have it work, with no signup and no keys.
>
> How it is put together:
>
> - **MV3, vanilla JS, zero dependencies, strict CSP** (`script-src 'self'`). No build
>   step. The whole thing is 150KB packed.
> - **One Cloudflare Worker** is the only host in `host_permissions`. It holds every API
>   key and returns JSON only — never executable code, which keeps the remote-code
>   review clean.
> - **Edge caching is what makes the free tier survive.** 100 people analyzing AAPL is
>   one upstream AI call, not 100. Prices are cached 20s so every tab shows the same
>   number.
> - **Permissions are `storage`, `alarms`, `notifications`.** Notably *not* `tabs` —
>   `chrome.tabs.create()` does not need it, only reading tab properties does. Worth
>   checking your own manifest for this; it is the cheapest review win there is.
> - Content script reads visible text only to find cashtags, sends nothing but the
>   symbol the user clicks.
>
> The part that took longest was not the AI, it was ticker resolution. Free data tiers
> are US-only, so a bare foreign symbol needs an exchange probe, and then you need to
> cache the result or you die the first time the upstream throttles you.
>
> Source: https://github.com/mrignis/ai-stock-analyzer — happy to answer anything about
> the Worker side.

**First comment:** the store link.

---

### Show HN

HN wants plain and technical. No adjectives.

> **Title:** Show HN: Chrome extension that explains any stock ticker on the page you're reading
>
> It highlights tickers on finance sites, Reddit and X. Hover gives a live price; click
> gives company description, sector, risk, analyst consensus, upcoming earnings and an
> AI verdict. There is a portfolio tab that imports broker CSVs and handles mixed
> currencies properly.
>
> No account, no API keys. A single Cloudflare Worker holds the keys and edge-caches
> aggressively, so one analysis of AAPL serves everyone who asks for it that hour —
> that is the only reason the free tier holds.
>
> MV3, vanilla JS, no dependencies, no build step, 150KB. Source is open.
>
> The unglamorous hard part was symbol resolution: free market-data tiers are US-only,
> so a bare foreign ticker like SAU has to be probed across exchange suffixes to find
> SAU.TO, and those lookups have to be cached or the whole thing 404s the moment the
> upstream throttles you.
>
> It is not financial advice and the UI says so; the AI is there to summarise public
> information quickly, not to tell anyone what to buy.
>
> https://chromewebstore.google.com/detail/gmildjlnkoljdenbocapnkpllgkdombk

---

### Product Hunt

- **Tagline (60 chars max):** `Understand any stock ticker without leaving the page`
- **Description:** Highlights tickers on finance sites, Reddit and X. Hover for a live
  price, click for sector, risk, analyst consensus, earnings dates and an AI verdict.
  Imports broker CSVs into a multi-currency portfolio. No account, no API keys, free.
- **First comment (maker):** the build story from the r/SideProject post, shortened.

---

## 4. Answers for the comments

The first hour decides the post. Have these ready.

**"How is this free? What's the catch?"**
> Free tiers, and aggressive caching so I stay inside them. One AI call is shared by
> everyone who asks about the same ticker that hour. If it ever stops being
> sustainable I will say so here rather than quietly adding a paywall.

**"What do you do with my data?"**
> Watchlist, portfolio and history never leave your browser — they are in
> `chrome.storage.local`. The only thing that reaches my server is the ticker you
> choose to look up. The content script reads visible page text to find cashtags and
> sends none of it. No accounts, no analytics, no ads.

**"AI stock picks are garbage / this will lose people money"**
> Fair, and I agree with the instinct. It is a summariser, not a signal — it pulls
> together what is public about a company and writes it in one place. The UI says "not
> financial advice" on every result. The parts I actually trust are the boring ones:
> live prices, analyst consensus, earnings dates, portfolio math.

**"Which AI?"**
> gpt-oss-120b via Groq, with a smaller model as fallback at peak. Both models I
> started with were deprecated by the provider mid-flight, so the fallback is not
> theoretical.

**"Why should I trust a random extension with page access?"**
> You shouldn't on my word — the source is open, it is 150KB of vanilla JS with no
> build step, so what is on GitHub is what ships. Permissions are storage, alarms and
> notifications, and one host. Content scripts are scoped to a fixed list of finance
> and social sites, not `<all_urls>`.

**"Does it work for non-US stocks?"**
> Yes — TSX, LSE, ASX, V, NEO and NSE listings resolve, and a mixed CAD/USD portfolio
> converts properly instead of showing a phantom FX loss. That took more work than
> everything else combined.

**"Firefox / Edge?"**
> Not yet. Edge is realistic since it takes Chrome extensions; Firefox needs manifest
> work. If there is demand here I will do it.

---

## 5. The demo GIF

This matters more than any sentence above — on Reddit a good GIF is most of the post.
I cannot record it (it needs the real extension in a real browser), so:

**Record at 1280×800, keep it under 15 seconds, no intro card, no music.** Start on the
action immediately; the first frame has to show the product doing something.

Shot list, in this order:

1. A Reddit thread with `$NVDA` in it, already highlighted. Hover → the price card
   appears. **(This is the hook. ~3s.)**
2. Click it → the full analysis opens: verdict, sector, risk.
3. Scroll once to show earnings date + analyst consensus.
4. Click the chart button → TradingView chart opens.
5. Portfolio tab → the AI review overlay.

Tools: ScreenToGif or ShareX, both free. Export under 5MB or Reddit will re-encode it
to mush.

While you are at it, the store screenshots are from 17 June and predate all of this.
Retake them from the same recording session — same five shots, as stills.

---

## 6. Before you post, fix these two fields

Your store listing has **Homepage URL and Support URL empty**. They cost a minute and
people do check:

```
Homepage: https://mrignis.github.io/ai-stock-analyzer/
Support:  https://github.com/mrignis/ai-stock-analyzer/issues
```

---

## 7. What success looks like

Be realistic. A good r/SideProject post is a few hundred visitors and maybe 20-40
installs. That is not a failure — it is a 3x on your current user base, and more
importantly it is the first time you get real feedback from strangers.

**The thing to optimise for is not installs, it is your first reviews.** You have 9
users and no ratings, and an extension with no ratings does not rank in store search
and does not convert the people who do find it. If the launch gets you five honest
reviews, that is worth more than the traffic.

Do not ask for reviews in the post — Reddit hates it. Ask the people who email or
comment positively, individually, after they have used it for a few days.
