Add a new LinkedIn post to the journey calendar.

The user will provide a LinkedIn post URL as: $ARGUMENTS

Follow these steps:

## Step 1: Fetch the LinkedIn post data

Use WebFetch to fetch the LinkedIn post URL and extract:
- The full post text/body
- The date it was posted (in YYYY-MM-DD format)
- Any image URL (if present)

## Step 2: Call Gemini 2.5 Flash to determine category and title

Use a curl command to call the Gemini API. The API key is in the environment variable GEMINI_API_KEY.

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{"text": "PROMPT_HERE"}]
    }]
  }'
```

The prompt sent to Gemini should be:

```
You are categorizing LinkedIn posts for a personal journey calendar. Based on the post text below, provide:

1. A category — exactly one of:
   - "build" — if the post is about building something, coding, making a project, completing a hackathon, shipping something
   - "ai" — if the post is primarily about an AI moment, AI tools, or an interesting AI experience
   - "life" — if the post is about personal growth, learning, career milestones, reflections, celebrations, or life events

2. A short title (3-7 words) that captures the essence of the post. Look at these examples for tone and style:
   - "First webpage ever"
   - "Rock, Paper, Scissors"
   - "My first calculator"
   - "I showed Claude a screenshot of a button — he deleted it"
   - "First hackathon: finished, proud, doing it again"

Respond in EXACTLY this JSON format, nothing else:
{"category": "build|ai|life", "title": "your title here"}

Post text:
POST_TEXT_HERE
```

Parse the JSON from Gemini's response to get the category and title.

## Step 3: Show the user what will be added

Display the extracted data to the user:
- Date
- Title (from Gemini)
- Category (from Gemini)
- Body text (from LinkedIn)
- URL

Ask the user to confirm before proceeding.

## Step 4: Insert into MILESTONES array

In `/home/tamara/tamara-rocks/index.html`, find the closing of the MILESTONES array (the line with just `];` after the last milestone entry) and insert the new entry BEFORE it.

The new entry should follow this exact format (matching existing entries):
```javascript
            {
                date: 'YYYY-MM-DD',
                title: 'TITLE_HERE',
                body: "BODY_TEXT_HERE",
                category: 'CATEGORY_HERE',
                url: 'LINKEDIN_URL_HERE'
            }
```

Make sure to add a comma after the previous last entry's closing `}` if there isn't one already.

Important:
- Escape any single quotes in the title with backslash
- Escape any double quotes in the body with backslash
- Keep the entries in chronological order — if the new post date is before the last entry, insert it in the correct position

## Step 5: Commit and push

After inserting the entry:
1. Stage only `index.html`: `git add index.html`
2. Commit with message: `Add LinkedIn post: TITLE_HERE`
3. Push to origin to trigger redeployment: `git push`
