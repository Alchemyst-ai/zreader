import type { ReactNode } from "react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsDesktop } from "../context";

export interface ResponsivePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Desktop surface. Mobile is always a bottom drawer. */
  desktop?: "dialog" | "sheet-left" | "sheet-right";
  /** Hide the header visually (still announced to assistive tech). */
  hideHeader?: boolean;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * shadcn "responsive dialog" pattern: a vaul Drawer on mobile, a Dialog or
 * Sheet on desktop. Mobile-first: renders the Drawer during SSR.
 */
export function ResponsivePanel({
  open,
  onOpenChange,
  title,
  description,
  desktop = "dialog",
  hideHeader,
  footer,
  className,
  children,
}: ResponsivePanelProps) {
  const isDesktop = useIsDesktop();
  const headerClass = hideHeader ? "sr-only" : undefined;

  if (isDesktop && desktop === "dialog") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("sm:max-w-lg", className)}>
          <DialogHeader className={headerClass}>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    );
  }

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={desktop === "sheet-left" ? "left" : "right"} className={cn("w-full gap-0 sm:max-w-md", className)}>
          <SheetHeader className={headerClass}>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-4 pb-4">{children}</div>
          </ScrollArea>
          {footer ? <SheetFooter>{footer}</SheetFooter> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={cn("max-h-[92svh]", className)}>
        <DrawerHeader className={cn("text-left", headerClass)}>
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer ? <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</DrawerFooter> : null}
      </DrawerContent>
    </Drawer>
  );
}
