import { coreAbi, erc20Abi } from '@tervane/core'
import { useState } from 'react'
import { useApp } from '../AppContext'
import { LedgerGate, LedgerStatus } from '../LedgerGate'
import { DEP, GAS } from '../lib/config'
import { eth, parseUnitsSafe, usd } from '../lib/format'
import { clearData, exportData } from '../lib/storage'
import { runTxs, type TxPhase } from '../lib/tx'
import { Segmented } from '../../components/Segmented'
import { Field, KV, Notice, Panel, TxButton } from '../ui/ui'

type Asset = 'usd' | 'eth'
const DEC: Record<Asset, number> = { usd: 6, eth: 18 }
const SYM: Record<Asset, string> = { usd: 'tUSD', eth: 'tETH' }
const fmt = (a: Asset, x: bigint) => (a === 'usd' ? usd(x) : eth(x))

export function Wallet() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Wallet</h1>
          <p>Deposits and withdrawal requests are public onchain transfers. Everything between them happens inside the sealed ledger.</p>
        </div>
      </div>
      <LedgerGate need="wallet"><WalletBody /></LedgerGate>
    </>
  )
}

function WalletBody() {
  const app = useApp()
  const w = app.wallet.data
  const [faucetPhase, setFaucetPhase] = useState<Record<Asset, TxPhase>>({ usd: 'idle', eth: 'idle' })
  const [depAsset, setDepAsset] = useState<Asset>('usd')
  const [depAmt, setDepAmt] = useState('')
  const [depPhase, setDepPhase] = useState<TxPhase>('idle')
  const [wdAsset, setWdAsset] = useState<Asset>('usd')
  const [wdAmt, setWdAmt] = useState('')
  const [wdPhase, setWdPhase] = useState<TxPhase>('idle')
  const acct = app.ledger.data?.account

  const depValue = parseUnitsSafe(depAmt, DEC[depAsset])
  const depBal = w ? (depAsset === 'usd' ? w.usd : w.eth) : 0n
  const depErr = depAmt && depValue === null ? 'Enter a number.' : depValue !== null && depValue > depBal ? `You hold ${fmt(depAsset, depBal)} ${SYM[depAsset]}.` : null
  const wdValue = parseUnitsSafe(wdAmt, DEC[wdAsset])
  const freeForWd = acct ? BigInt(wdAsset === 'usd' ? acct.usdFree : acct.ethFree) : null
  const wdErr = wdAmt && wdValue === null ? 'Enter a number.' : null
  const token = (a: Asset) => (a === 'usd' ? DEP.usdToken : DEP.ethToken)

  const faucet = async (a: Asset) => {
    await runTxs(`Faucet ${SYM[a]}`, [{ address: token(a), abi: erc20Abi, functionName: 'faucet', gas: GAS.faucet }], (p) => setFaucetPhase((s) => ({ ...s, [a]: p })))
    app.wallet.refetch()
  }
  const deposit = async () => {
    if (!depValue) return
    const r = await runTxs(`Deposit ${SYM[depAsset]}`, [
      { address: token(depAsset), abi: erc20Abi, functionName: 'approve', args: [DEP.tervaneCore, depValue], gas: GAS.approve },
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'deposit', args: [depAsset === 'usd' ? 0 : 1, depValue], gas: GAS.deposit },
    ], setDepPhase)
    if (r) setDepAmt('')
    app.wallet.refetch()
  }
  const withdraw = async () => {
    if (!wdValue) return
    const r = await runTxs(`Request ${SYM[wdAsset]} withdrawal`, [
      { address: DEP.tervaneCore, abi: coreAbi, functionName: 'requestWithdraw', args: [wdAsset === 'usd' ? 0 : 1, wdValue], gas: GAS.requestWithdraw },
    ], setWdPhase)
    if (r) setWdAmt('')
    app.wallet.refetch()
  }

  return (
    <div className="stack">
      <div className="grid-2">
        <Panel title="In your wallet" aside={<span className="muted xs">onchain</span>}>
          <dl>
            <KV k="MON (gas)" v={w ? eth(w.mon, 3) : '…'} />
            <KV k="tUSD" v={w ? usd(w.usd) : '…'} />
            <KV k="tETH" v={w ? eth(w.eth) : '…'} />
          </dl>
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <TxButton phase={faucetPhase.usd} variant="secondary" onClick={() => faucet('usd')}>Get 10,000 tUSD</TxButton>
            <TxButton phase={faucetPhase.eth} variant="secondary" onClick={() => faucet('eth')}>Get 10 tETH</TxButton>
          </div>
          <p className="muted xs" style={{ marginTop: 'var(--s-3)' }}>Test tokens, once per day per address.</p>
        </Panel>

        <Panel title="In the ledger" aside={app.session ? <span className="muted xs">sealed · visible to you and the server</span> : null}>
          <LedgerGate>
            <dl>
              <KV k="tUSD free" v={acct ? usd(BigInt(acct.usdFree)) : '0.00'} />
              <KV k="tUSD reserved in lend orders" v={acct ? usd(BigInt(acct.usdReserved)) : '0.00'} />
              <KV k="tETH free" v={acct ? eth(BigInt(acct.ethFree)) : '0.0000'} />
              <KV k="tETH reserved in borrow orders" v={acct ? eth(BigInt(acct.ethReserved)) : '0.0000'} />
              <KV k="tETH locked as collateral" v={acct ? eth(BigInt(acct.ethLocked)) : '0.0000'} />
            </dl>
            {!acct && <p className="muted xs" style={{ marginTop: 'var(--s-3)' }}>No ledger account yet. It appears after your first deposit settles.</p>}
          </LedgerGate>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Deposit">
          <div className="stack-sm">
            <div className="form-row"><span>Asset</span><Segmented options={[{ value: 'usd', label: 'tUSD' }, { value: 'eth', label: 'tETH' }]} value={depAsset} onChange={setDepAsset} label="Deposit asset" /></div>
            <Field label="Amount" suffix={SYM[depAsset]} placeholder="0.00" value={depAmt} onChange={(e) => setDepAmt(e.target.value)} error={depErr}
              action={<button type="button" className="linkbtn" onClick={() => setDepAmt(fmt(depAsset, depBal).replace(/,/g, ''))}>Max {fmt(depAsset, depBal)}</button>}
              hint="Approve, then deposit: two wallet confirmations. Credited at the next epoch." />
            <TxButton phase={depPhase} wide disabled={!depValue || !!depErr} onClick={deposit}>Deposit</TxButton>
          </div>
        </Panel>

        <Panel title="Request a withdrawal">
          <div className="stack-sm">
            <div className="form-row"><span>Asset</span><Segmented options={[{ value: 'usd', label: 'tUSD' }, { value: 'eth', label: 'tETH' }]} value={wdAsset} onChange={setWdAsset} label="Withdrawal asset" /></div>
            <Field label="Amount" suffix={SYM[wdAsset]} placeholder="0.00" value={wdAmt} onChange={(e) => setWdAmt(e.target.value)} error={wdErr}
              hint={freeForWd !== null ? `Free in the ledger: ${fmt(wdAsset, freeForWd)} ${SYM[wdAsset]}. The enclave pays up to your free balance at the next epoch.` : 'Paid at the next epoch, capped at your free ledger balance.'} />
            <TxButton phase={wdPhase} wide disabled={!wdValue || !!wdErr} onClick={withdraw}>Request withdrawal</TxButton>
            {w && (w.pendingUsd > 0n || w.pendingEth > 0n) && (
              <Notice title="Pending requests">{w.pendingUsd > 0n && <div>{usd(w.pendingUsd)} tUSD</div>}{w.pendingEth > 0n && <div>{eth(w.pendingEth)} tETH</div>}</Notice>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="This device" aside={<span className="muted xs">your own bids, stored only here</span>}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <p className="muted small" style={{ maxWidth: '60ch' }}>
            {app.local.intents.length} intent{app.local.intents.length === 1 ? '' : 's'} remembered, including the rates you chose. They are never sent anywhere.
          </p>
          <div className="row">
            <button className="btn" data-variant="secondary" data-size="sm" onClick={() => {
              const blob = new Blob([exportData(app.address!)], { type: 'application/json' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tervane-local-data.json'; a.click(); URL.revokeObjectURL(a.href)
            }}>Export my data</button>
            <button className="btn" data-variant="secondary" data-size="sm" onClick={() => { if (confirm('Forget the bids remembered on this device? Your orders are unaffected; you just won’t see your own rates here.')) clearData(app.address!) }}>Clear</button>
          </div>
        </div>
      </Panel>
      <LedgerStatus />
    </div>
  )
}
