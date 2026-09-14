# 🚀 N8N Multi-Agent System - Quick Start Guide

## 5-Minute Setup

### Prerequisites Checklist
- [ ] Claude API key (from Anthropic)
- [ ] GitHub token
- [ ] n8n instance (self-hosted or cloud)
- [ ] Node.js 16+ installed
- [ ] Your product/service description ready

---

## Step 1: Get Your API Keys (2 minutes)

### Claude API Key
1. Visit https://console.anthropic.com/
2. Sign in or create account
3. Go to "API Keys"
4. Create new API key
5. Copy: `sk-ant-xxxxxxxxxxxxx`

### GitHub Token
1. Go to https://github.com/settings/tokens
2. Click "Generate new token"
3. Select scopes: `repo` (full control)
4. Copy your token: `ghp_xxxxxxxxxxxxx`

---

## Step 2: Start N8N (3 minutes)

### Option A: Local Installation
```bash
# Install globally
npm install -g n8n

# Start n8n
n8n start

# Access at: http://localhost:5678
```

### Option B: Docker
```bash
docker run -it --rm \
  -p 5678:5678 \
  -e N8N_ENCRYPTION_KEY="your-secure-key" \
  n8nio/n8n

# Access at: http://localhost:5678
```

### Option C: Cloud
- Sign up at https://app.n8n.cloud/
- Create new workspace
- Ready to use

---

## Step 3: Import Workflow (1 minute)

1. **Open n8n Dashboard**
   - Go to http://localhost:5678
   - Click "Workflows" → "New"

2. **Import JSON**
   - Click "Import from File"
   - Select: `N8N_COMPLETE_WORKFLOW.json`
   - Click "Import"

3. **Workflow loads with all 8 agents!**

---

## Step 4: Add Credentials (2 minutes)

### Add Claude API Key
1. Click "Credentials" (bottom left)
2. Click "+ New"
3. Search: "HTTP Bearer"
4. Name: `Claude API`
5. Paste your API key
6. Save

### Add GitHub Token
1. Click "+ New"
2. Search: "HTTP Bearer"
3. Name: `GitHub Token`
4. Paste your token
5. Save

---

## Step 5: Configure Agent Prompts (3 minutes)

### Edit Agent 1 (Market Research)
1. Click on "Agent 1: Market Research" node
2. Find the `body` parameter
3. Replace `"AGENT_1_PROMPT_HERE"` with:

```json
{
  "role": "user",
  "content": "Generate a comprehensive India market research document for [YOUR_PRODUCT/SERVICE] with 900 lines covering: (1) Market Overview - GDP, growth, trends (200 lines), (2) Demographic Analysis - urban/rural, income, education (200 lines), (3) Consumer Behavior - digital adoption, e-commerce, payments (200 lines), (4) Market Opportunities - growing segments, niches (200 lines), (5) Data & Sources - citations, methodology (100 lines). Use markdown with ##, ###, tables, and lists. Be specific and professional."
}
```

### Edit Other Agents
Repeat for Agents 2-8, replacing the prompt placeholders with appropriate agent-specific prompts from the Prompt Library below.

---

## Step 6: Test One Agent First ⚠️ IMPORTANT

### Test Agent 1 Only
1. Click "Agent 1: Market Research" node
2. Click "Execute Node" (▶️)
3. Wait 1-2 minutes
4. Check output in "Execution Results"
5. **Verify**: Output should be ~900 lines of markdown

### If Test Fails:
- Check API key is correct
- Ensure rate limits not exceeded
- Verify internet connection
- Check n8n logs: `tail -f logs/n8n.log`

---

## Step 7: Run Full Workflow

### Execute All Agents
1. Click "Execute Workflow" (big ▶️ button)
2. Or use keyboard: `Ctrl+Enter`
3. **Wait 10-15 minutes** for all agents to complete
4. Check "Execution History"
5. **Total output**: 6500-7000 lines across 8 documents

### Monitor Progress
```
⏳ Agent 1 (Market Research): 2 min
⏳ Agent 2 (Regulatory): 1.5 min
⏳ Agent 3 (Market Entry): 2.5 min
⏳ Agent 4 (Competitive): 2 min
⏳ Agent 5 (GTM Plan): 2 min
⏳ Agent 6 (Financial): 1.5 min
⏳ Agent 7 (Risk Mgmt): 1.5 min
⏳ Agent 8 (Roadmap): 2 min
─────────────────────────
Total: ~15 minutes
```

---

## Step 8: Download Your Files

### From n8n Output
1. Go to "Execution History"
2. Click latest execution
3. View "Summary Dashboard" output
4. Copy download links

### From GitHub
1. Visit: https://github.com/ghabilaadithyaa624/india-launch-playbook
2. Go to `/docs` folder
3. Download individual markdown files
4. Or download ZIP archive

### Files Available
```
docs/
├── 01-Market-Research.md (900 lines)
├── 02-Regulatory-Compliance.md (850 lines)
├── 03-Market-Entry-Strategy.md (1000 lines)
├── 04-Competitive-Analysis.md (900 lines)
├── 05-GTM-Plan.md (950 lines)
├── 06-Financial-Projections.md (850 lines)
├── 07-Risk-Management.md (800 lines)
├── 08-Implementation-Roadmap.md (900 lines)
└── MASTER-PLAYBOOK.md (all 8 combined)
```

---

## Configuration Templates

### Complete Environment Variables
```bash
# .env file
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
N8N_ENCRYPTION_KEY=your-secure-key-32-chars-minimum
GITHUB_REPO=ghabilaadithyaa624/india-launch-playbook
OUTPUT_DIR=/path/to/outputs
```

### Agent Parameters
```json
{
  "default": {
    "model": "claude-opus-5",
    "max_tokens": 4000,
    "temperature": 0.7
  },
  "agents": {
    "market_research": {
      "max_tokens": 4000,
      "target_lines": 900,
      "temperature": 0.7
    },
    "regulatory": {
      "max_tokens": 3500,
      "target_lines": 850,
      "temperature": 0.5
    },
    "market_entry": {
      "max_tokens": 4500,
      "target_lines": 1000,
      "temperature": 0.7
    }
  }
}
```

---

## Troubleshooting

### ❌ API Key Error
**Error**: "401 Unauthorized"
- **Fix**: Verify API key is correct
- Check: https://console.anthropic.com/api_keys
- Ensure no spaces in key

### ❌ Agent Timeout
**Error**: "Request timeout"
- **Fix**: Increase timeout in HTTP node
  - Change `max_tokens` to 3000-4000
  - Increase request timeout to 120 seconds

### ❌ Output < 700 Lines
**Error**: Agent produces less than 700 lines
- **Fix**: Modify prompt to be more specific
- Add: "Your response must be at least 900 lines"
- Increase `max_tokens` parameter

### ❌ GitHub Upload Fails
**Error**: "403 Forbidden"
- **Fix**: Verify GitHub token has `repo` scope
- Check: https://github.com/settings/tokens
- Token may have expired

### ❌ Markdown Formatting Issues
**Error**: Output has no markdown formatting
- **Fix**: System prompt emphasizes markdown
- Check: ##, ###, -, *, **bold**, etc.
- Re-run agent with fixed prompt

---

## Advanced Customization

### Custom Prompts for Your Product
```javascript
// Customize Agent 1 prompt for SaaS product
const market_research_prompt = `
Generate India market research for a ${YOUR_PRODUCT_TYPE} solution targeting ${YOUR_TARGET_SEGMENT}.

Include:
1. TAM/SAM analysis for your segment
2. Current market adoption rates
3. Key customer segments
4. Pricing benchmarks in India
5. Growth opportunities specific to your product

Output: 900 lines of professional markdown
`;
```

### Add Slack Notifications
1. In n8n: Add "Slack" node after Summary Dashboard
2. Connect to your Slack workspace
3. Receives completion notification with download links

### Schedule Recurring Generation
1. Replace "Manual Trigger" with "Cron" trigger
2. Set schedule: "Every week" or "Every month"
3. Auto-generates updated playbook on schedule

---

## Testing Checklist

- [ ] API keys are valid and working
- [ ] Single agent test passes (Agent 1)
- [ ] Output is 700-1000 lines for single agent
- [ ] Markdown formatting is present
- [ ] All 8 agents run without errors
- [ ] Total output exceeds 6000 lines
- [ ] GitHub upload successful
- [ ] Files are downloadable
- [ ] Master playbook is integrated properly

---

## Success Metrics

✅ **You're successful when:**
1. All 8 agents complete without errors
2. Each document is 700-1000 lines
3. Total: 5500-8000 lines across all docs
4. Files available in GitHub `/docs`
5. Master playbook integrates all content
6. PDF and markdown formats both work
7. ZIP archive downloads successfully

---

## File Structure After Generation

```
github-repo/
├── docs/
│   ├── 01-Market-Research.md
│   ├── 02-Regulatory-Compliance.md
│   ├── 03-Market-Entry-Strategy.md
│   ├── 04-Competitive-Analysis.md
│   ├── 05-GTM-Plan.md
│   ├── 06-Financial-Projections.md
│   ├── 07-Risk-Management.md
│   ├── 08-Implementation-Roadmap.md
│   └── MASTER-PLAYBOOK.md
├── pdfs/
│   ├── 01-Market-Research.pdf
│   ├── 02-Regulatory-Compliance.pdf
│   ... [all PDFs]
│   └── MASTER-PLAYBOOK.pdf
├── india-launch-playbook-complete.zip
├── README.md
└── manifest.json
```

---

## Next Steps

1. ✅ Follow steps 1-8 above (30 minutes total)
2. 📥 Download all generated documents
3. 📖 Review the Master Playbook
4. ✏️ Customize with specific company data
5. 📊 Present to stakeholders
6. 🔄 Regenerate monthly with updated info

---

## Support & Resources

### Documentation
- N8N Docs: https://docs.n8n.io/
- Claude API: https://docs.anthropic.com/
- GitHub API: https://docs.github.com/

### Community
- N8N Community: https://community.n8n.io/
- Claude Discord: https://discord.gg/anthropic
- GitHub Discussions: https://github.com/ghabilaadithyaa624/india-launch-playbook/discussions

### Need Help?
1. Check troubleshooting section above
2. Review logs: `n8n logs --level=debug`
3. Test individual agents first
4. Verify all credentials are correct

---

## 🎉 You're Ready!

Your N8N multi-agent system is now:
- ✅ Installed and configured
- ✅ Connected to Claude API
- ✅ Integrated with GitHub
- ✅ Ready to generate documents

**Time to first document generation: ~45 minutes from now**

**Happy generating!** 🚀

