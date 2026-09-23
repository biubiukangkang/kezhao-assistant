import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { openUpdateDownload, type UpdateInfo } from "@/lib/updater";

/** 新版本弹窗（启动静默检查与设置页手动检查共用）：说明 + 覆盖安装引导 */
export function UpdateDialog({
  update,
  onClose,
}: {
  update: UpdateInfo | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={!!update} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>发现新版本 v{update?.versionName}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1.5">
              {(update?.notes ?? []).map((line: string, i: number) => (
                <p key={i}>· {line}</p>
              ))}
              <p className="pt-1 text-muted-foreground">
                点「下载并安装」后进度在通知栏看，下完自动弹出安装，
                <span className="font-medium text-foreground">直接覆盖安装</span>
                ——照片、课表、设置全部自动保留，别卸载重装。
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>稍后再说</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (update) void openUpdateDownload(update.apkUrl);
              onClose();
            }}
          >
            下载并安装
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
