# 🔒 Security Checklist for Delta-Neutral Bot

**CRITICAL**: This bot handles real funds and private keys. Follow this checklist before committing or deploying.

## ✅ Pre-Commit Checklist

### 1. **Environment Files**
- [ ] `.env*` files are NOT staged for commit
- [ ] `.env.example` is the only env file in git
- [ ] No private keys in any tracked files
- [ ] No RPC URLs with API keys in tracked files

**Verify:**
```bash
git status --ignored | grep .env
# Should only show .env.example as untracked (if new)
```

### 2. **Wallet Files**
- [ ] No `*.json` wallet files are staged
- [ ] `devnet-wallet.json`, `mainnet-wallet.json` are ignored
- [ ] Check for accidental wallet file commits

**Verify:**
```bash
git check-ignore devnet-wallet.json mainnet-wallet.json
# Should show these files are ignored
```

### 3. **State & Data Files**
- [ ] `data/` directory is NOT committed
- [ ] `state.json`, `journal.json` are ignored
- [ ] No position data or transaction history in git

**Verify:**
```bash
git check-ignore data/state.json data/journal.json
# Should confirm both are ignored
```

### 4. **Review Staged Changes**
- [ ] Run `git diff --cached` and review ALL changes
- [ ] No hardcoded private keys in code
- [ ] No hardcoded RPC endpoints with keys
- [ ] No sensitive addresses or transaction hashes

**Verify:**
```bash
git diff --cached | grep -i "private\|key\|secret"
# Should return nothing sensitive
```

---

## 🛡️ Pre-Deployment Checklist

### 1. **Configuration**
- [ ] `.env.mainnet` exists and is configured
- [ ] `PRIVATE_KEY` is correct for mainnet wallet
- [ ] `RPC_URL` uses authenticated endpoint
- [ ] Risk parameters are set conservatively

### 2. **Wallet Security**
- [ ] Mainnet wallet has sufficient SOL for fees
- [ ] Wallet private key is stored securely (not in plaintext)
- [ ] Backup of wallet exists in secure location
- [ ] Wallet address is whitelisted (if using restrictions)

### 3. **Risk Limits**
- [ ] `DELTA_THRESHOLD_SOL` is appropriate for your size
- [ ] `MAX_SHORT_NOTIONAL_USD` limits exposure
- [ ] `MIN_COLLATERAL_RATIO` prevents liquidation
- [ ] `FUNDING_RATE_CAP_BPS` protects against high funding

### 4. **Testing**
- [ ] Tested on localnet with mainnet fork
- [ ] Tested with small amounts on devnet
- [ ] Emergency flows tested and working
- [ ] Monitoring and logging verified

---

## 🚨 Security Incidents

### If Private Key is Compromised:

1. **Immediate Actions:**
   ```bash
   # Transfer all funds to new wallet
   # Revoke all approvals
   # Close all positions
   ```

2. **Rotate Credentials:**
   - Generate new wallet: `solana-keygen new`
   - Update `.env.mainnet` with new key
   - Never reuse compromised wallet

3. **Review Logs:**
   - Check `data/journal.json` for suspicious activity
   - Review all recent transactions
   - Check Drift and Meteora positions

### If Committed to Git:

1. **Remove from history:**
   ```bash
   # Remove sensitive file from git history
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env.mainnet" \
     --prune-empty --tag-name-filter cat -- --all

   # Force push (if already pushed)
   git push --force --all
   ```

2. **Rotate ALL credentials:**
   - The key is now public - rotate immediately
   - Update RPC API keys
   - Change all wallet keys

3. **Notify team:**
   - Report security incident
   - Review access controls
   - Update security procedures

---

## 📋 Regular Security Audit

### Weekly Checks:
- [ ] Review `.gitignore` is up to date
- [ ] Check no sensitive files in git: `git ls-files | grep -E '\.env|wallet\.json'`
- [ ] Verify wallet balances match expected values
- [ ] Review transaction logs for anomalies

### Monthly Checks:
- [ ] Rotate RPC API keys
- [ ] Update dependencies: `pnpm update`
- [ ] Review and update risk parameters
- [ ] Audit position performance and fees

### Before Major Updates:
- [ ] Backup all state files to secure location
- [ ] Document current positions and balances
- [ ] Test update on devnet first
- [ ] Have rollback plan ready

---

## 🔐 Best Practices

### DO:
✅ Use hardware wallets for large amounts
✅ Use environment variables for all secrets
✅ Rotate credentials regularly
✅ Monitor positions continuously
✅ Keep backups in secure, offline storage
✅ Use Jito bundles for MEV protection
✅ Test emergency flows regularly

### DON'T:
❌ Commit private keys to git (ever!)
❌ Share private keys via chat/email
❌ Store keys in plaintext files
❌ Use same wallet for multiple bots
❌ Deploy without testing on devnet
❌ Ignore risk limit warnings
❌ Skip emergency flow testing

---

## 📞 Emergency Contacts

If security incident occurs:

1. **Stop the bot immediately**
2. **Secure remaining funds**
3. **Document the incident**
4. **Follow incident response plan above**

---

## 📚 Resources

- [Solana Security Best Practices](https://docs.solana.com/developers/security)
- [Git Security](https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage)
- [Drift Protocol Docs](https://docs.drift.trade/)
- [Meteora DLMM Docs](https://docs.meteora.ag/)

---

**Last Updated**: 2025-10-27
**Review Frequency**: Before each deployment
