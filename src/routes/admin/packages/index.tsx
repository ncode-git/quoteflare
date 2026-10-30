import { createFileRoute, useRouter } from '@tanstack/react-router'
import { getPackages } from '#/server/packages-actions'
import { useState } from 'react'
import { useConfirm } from '@/components/common/confirm-dialog'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react'
import { CategoriesDialog } from '@/components/common/categories-dialog'
import PageHeader from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card, CardContent } from '@/components/ui/card'
import type { PackageRow } from '#/server/packages'
import {
  reorderPackagesAction,
  savePackageCategoriesAction,
  setPackageActiveAction,
} from '#/server/packages-actions'
import { PackageDialog } from './-components/package-dialog'
import { toast } from 'sonner'
import { callAction } from '#/lib/action-errors'

export const Route = createFileRoute('/admin/packages/')({
  loader: () => getPackages(),
  component: PackagesPage,
})

function PackagesPage() {
  const { packages, categories, services } = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<PackageRow | 'new' | null>(null)
  const [editingCategories, setEditingCategories] = useState(false)
  const [busy, setBusy] = useState(false)

  const { confirm, dialog } = useConfirm()

  const run = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(true)
    try {
      const result = await callAction(
        action,
        'Could not update the packages. Try again.',
      )
      if (result && !result.ok) {
        toast.error(result.error ?? 'Something went wrong.')
      }
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const move = (index: number, offset: -1 | 1) => {
    const ids = packages.map((p) => p.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + offset, 0, moved)
    return run(() => reorderPackagesAction({ data: { ids } }))
  }

  const toggle = async (pkg: PackageRow) => {
    if (
      pkg.active &&
      !(await confirm({
        title: `Archive ${pkg.name}?`,
        description:
          'Archived packages no longer appear in the calculator. Existing quotes and invoices keep them.',
        confirmLabel: 'Archive package',
      }))
    )
      return
    await run(() =>
      setPackageActiveAction({ data: { id: pkg.id, active: !pkg.active } }),
    )
  }

  return (
    <>
      <PageHeader
        title="Packages"
        description="Ready-made starting points shown first in the price calculator."
      >
        <Button variant="outline" onClick={() => setEditingCategories(true)}>
          Categories
        </Button>
        <Button onClick={() => setEditing('new')}>
          <PlusIcon data-icon="inline-start" />
          New package
        </Button>
      </PageHeader>

      {packages.length === 0 ? (
        <p className="text-muted-foreground">
          No packages yet. The calculator offers only Start from scratch.
        </p>
      ) : (
        <div className="grid gap-4">
          {packages.map((pkg, index) => (
            <Card key={pkg.id} data-testid="package-row">
              <CardContent className="flex items-start justify-between gap-16">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{pkg.name}</h2>
                    {pkg.categoryName && (
                      <Badge variant="outline">{pkg.categoryName}</Badge>
                    )}
                    {pkg.isPrivate && <Badge variant="outline">Private</Badge>}
                    {!pkg.active && <Badge variant="secondary">Archived</Badge>}
                  </div>
                  {pkg.description && (
                    <p className="text-sm text-muted-foreground">
                      {pkg.description}
                    </p>
                  )}
                  <p className="text-sm">
                    {pkg.items
                      .map((i) =>
                        i.quantity > 1
                          ? `${i.serviceName} x${i.quantity}`
                          : i.serviceName,
                      )
                      .join(', ')}
                  </p>
                </div>
                <ButtonGroup>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Move ${pkg.name} up`}
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Move ${pkg.name} down`}
                    disabled={busy || index === packages.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Edit ${pkg.name}`}
                    onClick={() => setEditing(pkg)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`${pkg.active ? 'Archive' : 'Restore'} ${pkg.name}`}
                    disabled={busy}
                    onClick={() => void toggle(pkg)}
                  >
                    {pkg.active ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
                  </Button>
                </ButtonGroup>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CategoriesDialog
        open={editingCategories}
        categories={categories}
        noun="packages"
        save={(values) => savePackageCategoriesAction({ data: values })}
        onClose={() => setEditingCategories(false)}
      />
      <PackageDialog
        editing={editing}
        categories={categories}
        services={services}
        onClose={() => setEditing(null)}
      />
      {dialog}
    </>
  )
}
