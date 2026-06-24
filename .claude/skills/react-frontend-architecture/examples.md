# Examples — react-frontend-architecture

Good/bad pairs for each rule in [SKILL.md](SKILL.md). Vendor-agnostic (plain React 19 + Next.js 15 App Router). File trees use generic `src/`.

---

## 1. Feature-based over type-based structure

❌ **Bad** — type-based; one feature smeared across many top-level folders:

```
src/
  components/   ProductCard.tsx  CartItem.tsx  CheckoutForm.tsx  Header.tsx
  hooks/        useCart.ts  useProducts.ts  useAuth.ts
  utils/        cartTotals.ts  authToken.ts  formatPrice.ts
  types/        cart.ts  product.ts  user.ts
```
Editing "cart" means hopping across 4 directories; nothing tells you what belongs together.

✅ **Good** — feature-based; each feature self-contained, shared layer for true cross-cutting code:

```
src/
  features/
    cart/
      components/  CartItem.tsx  CartSummary.tsx
      hooks/       useCart.ts
      api/         cart.api.ts
      cart.types.ts
      cart.constants.ts
      cart.helpers.ts        # project-specific glue
    products/
      components/  ProductCard.tsx
      hooks/       useProducts.ts
      products.types.ts
  shared/
    components/ui/  Button.tsx  Modal.tsx
    utils/          formatPrice.ts   # generic, pure, reusable
    lib/            apiClient.ts
  app/                              # routing only (Next.js App Router)
```
Type-based is acceptable for a tiny app — but migrate to feature-based before it grows.

---

## 2. utils vs helpers, and constants placement

❌ **Bad** — a side-effecting "util", magic values inline, one mega-file:

```ts
// src/utils.ts  (3000 lines, everything dumped here)
export function formatPrice(c: number) { return `$${(c / 100).toFixed(2)}` }
export function saveToken(t: string) { localStorage.setItem('tkn', t) } // side effect — NOT a util
// ...component code:
if (cart.items.length > 50) showWarning()   // magic number 50 inline
```

✅ **Good** — pure utils vs domain helpers vs named constants, split by domain:

```ts
// src/shared/utils/formatPrice.ts   — generic, pure, project-agnostic
export const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`

// src/features/auth/auth.service.ts — side effects live in a service, not utils/
export const saveToken = (t: string) => localStorage.setItem('tkn', t)

// src/features/cart/cart.constants.ts
export const MAX_CART_ITEMS = 50

// usage
if (cart.items.length > MAX_CART_ITEMS) showWarning()
```

---

## 3. Where business logic lives

❌ **Bad** — fetching + business logic inside the component body:

```tsx
function OrdersPage() {
  const [orders, setOrders] = useState([])
  useEffect(() => {
    fetch('/api/orders').then(r => r.json()).then(setOrders)
  }, [])
  const totalRevenue = orders                       // business logic in the component
    .filter(o => o.status === 'paid')
    .reduce((s, o) => s + o.amountCents, 0)
  return <Revenue value={totalRevenue} />
}
```

✅ **Good** — data access in a hook, domain logic in a pure function, component just renders:

```ts
// features/orders/orders.logic.ts  — pure, testable, no React
export const sumPaidRevenue = (orders: Order[]) =>
  orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amountCents, 0)

// features/orders/hooks/useOrders.ts
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: fetchOrders })
```
```tsx
// features/orders/components/OrdersPage.tsx
function OrdersPage() {
  const { data: orders = [] } = useOrders()
  return <Revenue value={sumPaidRevenue(orders)} />
}
```

---

## 4. Keep server-only code off the client (RSC / App Router)

❌ **Bad** — a module with a secret is importable from a Client Component:

```ts
// lib/data.ts  (no guard)
export async function getData() {
  return fetch('https://api/x', { headers: { authorization: process.env.API_KEY } })
}
// a 'use client' component can import this → key leaks / breaks
```

✅ **Good** — `server-only` guard makes client import a build error:

```ts
// lib/data.ts
import 'server-only'
export async function getData() {
  return fetch('https://api/x', { headers: { authorization: process.env.API_KEY } })
}
```
And re-verify auth *inside* a server action — a page check doesn't cover it:
```ts
'use server'
export async function deleteOrder(id: string) {
  const user = await requireUser()          // re-check, every action
  if (!user.canDelete) throw new Error('Forbidden')
  // ...
}
```

---

## 5. Import boundaries & dependency direction

❌ **Bad** — feature reaches into another feature's internals:

```ts
// features/cart/CartSummary.tsx
import { calcTax } from '../checkout/internals/tax'   // cross-feature reach-in → coupling
```

✅ **Good** — shared code is promoted; features compose at the app level:

```ts
// shared/pricing/tax.ts          ← promoted because 2+ features need it
export const calcTax = (cents: number) => Math.round(cents * 0.2)

// features/cart/CartSummary.tsx
import { calcTax } from '@/shared/pricing/tax'
```
Enforce it:
```jsonc
// .eslintrc — import/no-restricted-paths
{ "zones": [{ "target": "src/features/cart", "from": "src/features/checkout",
              "message": "No cross-feature imports — compose at the app level." }] }
```

---

## 6. Barrel files

❌ **Bad** — a barrel re-exporting everything (breaks tree-shaking, risks cycles):

```ts
// features/cart/index.ts
export * from './components/CartItem'
export * from './components/CartSummary'
export * from './hooks/useCart'
export * from './cart.helpers'
// importing one icon now pulls the whole feature into the bundle
```

✅ **Good** — import directly from the source:

```ts
import { CartSummary } from '@/features/cart/components/CartSummary'
import { useCart } from '@/features/cart/hooks/useCart'
```
Exception: a single deliberate public entry point for a *published package* or architectural slice is fine — a narrow API, not a re-export of everything.

---

## 7. Path aliases over deep relative imports

❌ **Bad:**
```ts
import { Button } from '../../../../shared/components/ui/Button'
```

✅ **Good:**
```ts
// tsconfig.json → "paths": { "@/*": ["./src/*"] }
import { Button } from '@/shared/components/ui/Button'
```

---

## 8. Composition over configuration (component splitting)

❌ **Bad** — one component growing config flags:

```tsx
<Card title="..." hasHeader showFooter footerAlign="right" isCompact variant="bordered" badge="new" />
```

✅ **Good** — compose with children/slots:

```tsx
<Card>
  <Card.Header>...</Card.Header>
  <Card.Body>...</Card.Body>
  <Card.Footer align="right">...</Card.Footer>
</Card>
```

---

## 9. children/composition to avoid prop drilling

❌ **Bad** — threading a prop through layers that don't use it:

```tsx
<Page user={user}><Sidebar user={user}><Nav user={user}><Avatar user={user} /></Nav></Sidebar></Page>
```

✅ **Good** — pass the element as a slot; intermediaries stay agnostic:

```tsx
<Page><Sidebar nav={<Nav><Avatar user={user} /></Nav>} /></Page>
```
Reach for context only when many distant components need the same value.

---

## 10. Props design with discriminated unions

❌ **Bad** — optional props that allow contradictory states:

```tsx
type ButtonProps = { variant?: 'link' | 'icon'; href?: string; icon?: ReactNode; label?: string }
// nothing stops <Button variant="link" icon={<X/>} />  (no href, stray icon)
```

✅ **Good** — discriminated union; invalid combos are unrepresentable:

```tsx
type ButtonProps =
  | { variant: 'link'; href: string; label: string }
  | { variant: 'icon'; icon: ReactNode; 'aria-label': string }
// <Button variant="link" /> is now a type error unless href + label are provided
```

---

## 11. Server state ≠ client state

❌ **Bad** — copying server data into a global store, then keeping it in sync by hand:

```ts
const useStore = create(set => ({ orders: [], setOrders: o => set({ orders: o }) }))
// every component re-fetches and pushes into the store; cache invalidation is manual
```

✅ **Good** — server cache owns server data; client store holds only client state:

```ts
// server state
const { data: orders } = useQuery({ queryKey: ['orders'], queryFn: fetchOrders })
// client state (UI only)
const useUiStore = create(set => ({ sidebarOpen: false, toggle: () => set(s => ({ sidebarOpen: !s.sidebarOpen })) }))
```

---

## 12. State by category

| State kind | Put it in | Don't |
|---|---|---|
| One component's UI | `useState`/`useReducer`, colocated | Lift to global "just in case" |
| Filters / pagination / sort | URL search params | Local state lost on refresh/share |
| Server data / entities | TanStack Query / SWR cache | Mirror into Redux/Zustand |
| Truly app-wide client state | Zustand / Jotai / Redux | Reach for it before it's app-wide |

---

## 13. Naming conventions

❌ **Bad:**
```
src/features/cart/Index.tsx        usecart.ts        Constants.TSX
function renderCartRow() { ... }    const x = true    // booleans without is/has
```

✅ **Good:**
```
src/features/cart/components/CartItem.tsx
src/features/cart/hooks/useCart.ts
src/features/cart/cart.constants.ts        // export const MAX_CART_ITEMS = 50
```
```ts
const isLoading = true
const hasAccess = user.role === 'admin'
function CartRow() { /* PascalCase — it returns JSX */ }
```
A custom hook you can't name clearly (`useCartPageEffectThing`) signals logic too coupled to one component — split it.
