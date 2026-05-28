import * as React from 'react'
import { lazy, Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Lazy-loaded so Three.js doesn't block initial parse in the main chunk.
const ShaderWaveBackground = lazy(() => import('@/components/ShaderWaveBackground'))
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { BorderBeam } from '@/components/ui/border-beam'
import { cn } from '@/lib/utils'
import {
  Coffee,
  ShoppingCart,
  Banknote,
  Car,
  Tv,
  ChevronRight,
  QrCode,
  TriangleAlert,
  Zap,
  ArrowUpRight,
  CirclePlus,
  Check,
} from 'lucide-react'

/**
 * Component showcase — pure component grid, glass everywhere, BorderBeam on
 * primary buttons. Same glass / button styling as the Connect screen.
 *
 *   GlassCard  — replaces shadcn Card surface with `glass-3`
 *   GlassButton — same look as ConnectScreen's "Connect" CTA: BorderBeam
 *                 ocean variant + translucent white-on-glass button body
 *
 * View at http://localhost:5173/?showcase=1
 */
export default function ShowcaseRoute() {
  return (
    <div className="dark h-dvh overflow-y-auto text-foreground antialiased relative showcase-scroll">
      {/* Backdrop — animated wave-mesh shader (ported from ASAP project) */}
      <Suspense
        fallback={<div className="fixed inset-0 -z-10" style={{ backgroundColor: '#212121' }} />}
      >
        <ShaderWaveBackground />
      </Suspense>

      <div className="max-w-7xl mx-auto px-6 py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Component Showcase
          </h1>
          <p className="text-sm text-muted-foreground">
            Apple-style glass surfaces · BorderBeam ocean on primary actions · base-vega preset
            (bIkfWwS)
          </p>
        </header>

        <div className="grid grid-cols-12 gap-4 auto-rows-min">
          {/* Contribution History */}
          <GlassCard className="col-span-12 md:col-span-4 row-span-2">
            <CardHeader>
              <CardTitle className="text-base">Contribution History</CardTitle>
              <CardDescription>Last 6 months of activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-2 h-28">
                {[40, 60, 35, 80, 55, 95].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-foreground/15 rounded-t"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
                {['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'].map(m => (
                  <span key={m}>{m}</span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat tag="Upcoming" value="May 25, 2024" sub="$1,000 scheduled" />
                <MiniStat tag="Auto-Save Plan" value="Accelerated" sub="Recurring weekly" />
              </div>
              <Button variant="outline" className="w-full">
                View Full Report
              </Button>
            </CardContent>
          </GlassCard>

          {/* Payout Threshold */}
          <GlassCard className="col-span-12 md:col-span-4 row-span-2">
            <CardHeader>
              <CardTitle className="text-base">Payout Threshold</CardTitle>
              <CardDescription>
                Set the minimum balance required before a payout is triggered.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Preferred Currency">
                <Select defaultValue="usd">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd">USD — United States Dollar</SelectItem>
                    <SelectItem value="eur">EUR — Euro</SelectItem>
                    <SelectItem value="gbp">GBP — British Pound</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-[11px] text-muted-foreground">Minimum Payout Amount</Label>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    $2500.00
                  </span>
                </div>
                <Slider defaultValue={[25]} max={100} />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>$50 (MIN)</span>
                  <span>$10,000 (MAX)</span>
                </div>
              </div>
              <Field label="Notes">
                <Textarea rows={3} placeholder="Add any notes for this payout configuration..." />
              </Field>
              <GlassButton className="w-full">Save Threshold</GlassButton>
            </CardContent>
          </GlassCard>

          {/* Savings Targets */}
          <GlassCard className="col-span-12 md:col-span-4 row-span-2">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Savings Targets</CardTitle>
                <CardDescription>Active milestones for 2024</CardDescription>
              </div>
              <Button size="sm" variant="ghost">
                <CirclePlus className="size-3.5" /> New Goal
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <SavingsRow tag="Retirement" value="$420,000" pct={65} achieved="$273,000" />
              <SavingsRow tag="Real Estate" value="$85,000" pct={32} achieved="$27,200" />
              <p className="text-xs text-muted-foreground pt-1">
                You have not met your targets for this year.
              </p>
            </CardContent>
          </GlassCard>

          {/* Buy Investment */}
          <GlassCard className="col-span-12 md:col-span-4 row-span-2">
            <CardHeader>
              <CardTitle className="text-base">Buy Investment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Amount to Invest">
                <Input defaultValue="$ 1,000.00" />
              </Field>
              <Field label="Order Type">
                <Select defaultValue="market">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market Order</SelectItem>
                    <SelectItem value="limit">Limit Order</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Market orders execute at the current price.
                </p>
              </Field>
              <div className="flex justify-between text-xs py-1.5 border-t border-border">
                <span className="text-muted-foreground">Estimated Shares</span>
                <span className="font-semibold tabular-nums text-foreground">1.95</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Buying Power</span>
                <span className="font-semibold tabular-nums text-foreground">$12,450.00</span>
              </div>
              <GlassButton className="w-full">Review Order</GlassButton>
              <p className="text-[11px] text-muted-foreground text-center">
                Trades are typically executed within minutes during market hours.
              </p>
            </CardContent>
          </GlassCard>

          {/* Distribute Track */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="size-9 rounded-md border border-dashed border-border mx-auto flex items-center justify-center text-muted-foreground">
                +
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Distribute Track</p>
                <p className="text-[11px] text-muted-foreground leading-snug max-w-[280px] mx-auto">
                  Upload your first master to start reaching listeners on Spotify, Apple Music, and
                  more.
                </p>
              </div>
              <GlassButton className="w-full">Create Release</GlassButton>
            </CardContent>
          </GlassCard>

          {/* Claimable Balance */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardHeader>
              <CardDescription>Claimable Balance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-bold tabular-nums text-foreground">$0.00</p>
              <Badge variant="outline" className="text-[10px]">
                <span className="size-1.5 rounded-full bg-amber-400" /> Pending Setup
              </Badge>
              <Separator />
              <Row label="Net Royalties" value="$0.00" />
              <Row label="Processing Fee" value="-$0.00" />
              <Row label="Total Ready to Claim" value="$0.00 USD" strong />
              <p className="text-[10px] text-muted-foreground leading-snug pt-1">
                Once your bank is connected, balances over $10.00 are automatically eligible for
                monthly distribution on the 15th of each month.
              </p>
            </CardContent>
          </GlassCard>

          {/* Recent Transactions */}
          <GlassCard className="col-span-12 md:col-span-8 row-span-2">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Recent Transactions</CardTitle>
                <CardDescription>Your latest account activity.</CardDescription>
              </div>
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {[
                  {
                    Icon: Coffee,
                    name: 'Blue Bottle Coffee',
                    tag: 'Food & Drink',
                    date: 'Today, 10:24 AM',
                    amt: '-$6.50',
                    neg: true,
                  },
                  {
                    Icon: ShoppingCart,
                    name: 'Whole Foods Market',
                    tag: 'Groceries',
                    date: 'Yesterday',
                    amt: '-$142.30',
                    neg: true,
                  },
                  {
                    Icon: Banknote,
                    name: 'Stripe Payout',
                    tag: 'Income',
                    date: 'Oct 12',
                    amt: '+$4,200.00',
                    neg: false,
                  },
                  {
                    Icon: Car,
                    name: 'Uber Technologies',
                    tag: 'Transport',
                    date: 'Oct 11',
                    amt: '-$24.10',
                    neg: true,
                  },
                  {
                    Icon: Tv,
                    name: 'Netflix Subscription',
                    tag: 'Entertainment',
                    date: 'Oct 10',
                    amt: '-$19.99',
                    neg: true,
                  },
                ].map(t => (
                  <li key={t.name} className="flex items-center gap-3 py-3">
                    <div className="size-9 rounded-md bg-muted shrink-0 flex items-center justify-center text-muted-foreground">
                      <t.Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.tag}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.date}</p>
                    <p
                      className={`text-sm font-semibold tabular-nums w-20 text-right ${t.neg ? 'text-foreground' : 'text-emerald-400'}`}
                    >
                      {t.amt}
                    </p>
                    <button className="text-muted-foreground hover:text-foreground">⋮</button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </GlassCard>

          {/* Account Access */}
          <GlassCard className="col-span-12 md:col-span-4 row-span-2">
            <CardHeader>
              <CardTitle className="text-base">Account Access</CardTitle>
              <CardDescription>Update your credentials or re-authenticate.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Email Address">
                <Input defaultValue="artist@studio.inc" />
              </Field>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label className="text-[11px] text-muted-foreground">Current Password</Label>
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground cursor-pointer"
                  >
                    Forgot?
                  </button>
                </div>
                <Input type="password" defaultValue="••••••••••••" />
              </div>
              <GlassButton className="w-full">
                <Check className="size-3.5" /> Update Security
              </GlassButton>
              <button className="w-full rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 flex items-center gap-2 text-left hover:bg-destructive/15 transition-colors">
                <TriangleAlert className="size-4 text-destructive" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-destructive">Danger Zone</p>
                  <p className="text-[11px] text-destructive/70">Archive account and remove…</p>
                </div>
                <ChevronRight className="size-4 text-destructive" />
              </button>
            </CardContent>
          </GlassCard>

          {/* QR scan card */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
              <div className="size-32 rounded-md bg-white flex items-center justify-center">
                <QrCode className="size-24 text-black" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Scan to connect your mobile device
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Open the Ledger mobile app and scan this code
                </p>
              </div>
            </CardContent>
          </GlassCard>

          {/* Card Balance */}
          <GlassCard className="col-span-6 md:col-span-2">
            <CardHeader>
              <CardDescription>Card Balance</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-foreground">US$12.94</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">US$11,337.06</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Available
              </p>
            </CardContent>
          </GlassCard>

          {/* Payment Due */}
          <GlassCard className="col-span-6 md:col-span-2">
            <CardHeader>
              <CardDescription>Payment Due</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">1 Apr</p>
              <Button size="sm" variant="outline" className="w-full mt-2">
                Pay Early
              </Button>
            </CardContent>
          </GlassCard>

          {/* Yearly Activity */}
          <GlassCard className="col-span-12 md:col-span-5">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Yearly Activity</CardTitle>
              </div>
              <Badge variant="outline" className="text-[10px]">
                +US$0.25 Daily Cash
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1.5 h-16">
                {Array.from({ length: 12 }, (_, i) => 30 + Math.sin(i / 1.6) * 25 + i * 4).map(
                  (h, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-foreground/20 hover:bg-foreground/40 rounded-sm transition-colors"
                      style={{ height: `${Math.min(100, h)}%` }}
                    />
                  ),
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">
                {'JFMAMJJASOND'.split('').map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            </CardContent>
          </GlassCard>

          {/* Power Usage */}
          <GlassCard className="col-span-6 md:col-span-3">
            <CardHeader>
              <CardDescription>Power Usage</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-1.5 text-foreground">
                <Zap className="size-5 text-amber-400" /> 3.4 kW
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[11px] text-muted-foreground">Whole Home</p>
              <Progress value={62} />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Battery Level</span>
                <span>82%</span>
              </div>
            </CardContent>
          </GlassCard>

          {/* Preferences */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Preferences</CardTitle>
              <CardDescription>Manage your account settings and notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Default Currency">
                <Select defaultValue="usd">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd">USD — United States Dollar</SelectItem>
                    <SelectItem value="eur">EUR — Euro</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground/80">Email notifications</Label>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground/80">Marketing emails</Label>
                <Switch />
              </div>
            </CardContent>
          </GlassCard>

          {/* Transfer Funds */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Transfer Funds</CardTitle>
              <CardDescription>Move money between your connected accounts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Amount to Transfer">
                <Input defaultValue="$ 1,200.00" />
              </Field>
              <Field label="From Account">
                <Select defaultValue="checking">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Main Checking (··8402) — $12,450.00</SelectItem>
                    <SelectItem value="savings">Savings (··3211) — $8,200.00</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="To Account">
                <Select defaultValue="hys">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hys">High Yield Savings (··1192) — $42,100.00</SelectItem>
                    <SelectItem value="brokerage">Brokerage (··7755) — $18,750.00</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <GlassButton className="w-full">Transfer Funds</GlassButton>
            </CardContent>
          </GlassCard>

          {/* Tabs */}
          <GlassCard className="col-span-12 md:col-span-4">
            <CardContent className="pt-6">
              <Tabs defaultValue="payments">
                <TabsList className="w-full">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="account">Account</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="mt-3 space-y-2">
                  <NavItem label="Dashboard" active />
                  <NavItem label="Transactions" />
                  <NavItem label="Investments" />
                </TabsContent>
                <TabsContent value="account" className="mt-3 space-y-2">
                  <NavItem label="Profile" />
                  <NavItem label="Billing" active />
                  <NavItem label="Notifications" />
                  <NavItem label="Security" />
                </TabsContent>
                <TabsContent value="payments" className="mt-3 space-y-2.5">
                  <NavItem label="Home" />
                  <div className="rounded-2xl border bg-muted/30 p-2.5">
                    <div className="flex items-start gap-2">
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[10px]">CT</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">
                          Change transfer limit
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          Adjust how much you can send from your balance.
                        </p>
                      </div>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-muted/30 p-2.5 flex items-center gap-2">
                    <Check className="size-4 text-muted-foreground" />
                    <p className="text-xs font-medium flex-1 text-foreground">
                      Scheduled transfers
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </GlassCard>

          {/* Buttons gallery */}
          <GlassCard className="col-span-12 md:col-span-6">
            <CardHeader>
              <CardTitle className="text-base">Buttons</CardTitle>
              <CardDescription>BorderBeam + glass on every primary action.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Variants</p>
              <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
                Sizes
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs">XS</Button>
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
                <Button size="icon">
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
                Major action — BorderBeam glass
              </p>
              <div className="flex flex-wrap gap-2">
                <GlassButton>Confirm Order</GlassButton>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </GlassCard>

          {/* Badges */}
          <GlassCard className="col-span-12 md:col-span-6">
            <CardHeader>
              <CardTitle className="text-base">Badges</CardTitle>
              <CardDescription>Status indicators and labels.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                Live
              </Badge>
              <Badge className="bg-amber-500/15 text-amber-300 border border-amber-400/30">
                Warning
              </Badge>
              <Badge className="bg-sky-500/15 text-sky-300 border border-sky-400/30">Info</Badge>
            </CardContent>
          </GlassCard>
        </div>
      </div>

      {/* Connect-screen button styles + scrollbar override, scoped to the showcase */}
      <style>{`
        /* Override the app-global scrollbar-hidden rules for the showcase only */
        .showcase-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
        .showcase-scroll::-webkit-scrollbar { display: block; width: 10px; }
        .showcase-scroll::-webkit-scrollbar-track { background: transparent; }
        .showcase-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 5px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .showcase-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.30); background-clip: padding-box; }

        .bb-pressable {
          transition: transform 240ms cubic-bezier(.4, 1.6, .5, 1);
          will-change: transform;
          transform-origin: center;
          display: block;
        }
        .bb-pressable:has(button:not(:disabled):active) {
          transform: scale(0.95);
          transition: transform 90ms cubic-bezier(.3, 0, .7, 1);
        }
        .bb-glass-btn {
          transition: background-color 160ms ease-out;
        }
        .bb-glass-btn:not(:disabled):hover {
          background: rgba(255,255,255,0.10) !important;
        }
      `}</style>
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Glass surface card. Uses the same `glass-3` utility the ConnectScreen uses. */
function GlassCard({ className, children, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        // strip shadcn surface, replace with glass-3
        '!bg-transparent !border-0 !shadow-none',
        'glass-3 rounded-[28px]',
        className,
      )}
      {...props}
    >
      {children}
    </Card>
  )
}

/**
 * White / primary button styled exactly like the ConnectScreen "Connect" CTA:
 * BorderBeam ocean variant + translucent white pane + soft inset highlight.
 */
function GlassButton({
  children,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <span
      className={cn('relative inline-block', className?.includes('w-full') ? 'block w-full' : '')}
    >
      <BorderBeam
        colorVariant="ocean"
        duration={5}
        strength={0.85}
        borderRadius={16}
        borderWidth={1}
        className="bb-pressable"
      >
        <button
          disabled={disabled}
          className={cn(
            'bb-glass-btn relative text-foreground font-semibold h-9 px-4 text-sm tracking-tight',
            'flex items-center justify-center gap-1.5',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            className,
          )}
          style={{
            borderRadius: 16,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: 'rgba(255, 255, 255, 0.06)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            boxShadow: '0 1px 0 rgb(255 255 255 / 0.14) inset',
          }}
          {...props}
        >
          {children}
        </button>
      </BorderBeam>
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function MiniStat({ tag, value, sub }: { tag: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tag}</p>
      <p className="text-sm font-semibold mt-0.5 truncate text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
    </div>
  )
}

function SavingsRow({
  tag,
  value,
  pct,
  achieved,
}: {
  tag: string
  value: string
  pct: number
  achieved: string
}) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-2.5 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tag}</p>
      <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <Progress value={pct} className="h-1.5" />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{pct}% achieved</span>
        <span className="tabular-nums">{achieved}</span>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums text-foreground ${strong ? 'font-semibold' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function NavItem({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40 text-muted-foreground',
      )}
    >
      <span className="size-3.5 rounded-sm bg-current opacity-70" />
      <span className="font-medium">{label}</span>
    </div>
  )
}
