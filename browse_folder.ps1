param(
    [string]$InitialDirectory = ""
)

Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Pilih folder yang ingin diaudit dan dibersihkan"
$dialog.ShowNewFolderButton = $true

if ($InitialDirectory -and (Test-Path $InitialDirectory)) {
    try {
        $dialog.SelectedPath = (Resolve-Path $InitialDirectory).Path
    } catch {
        $dialog.SelectedPath = [System.IO.Directory]::GetCurrentDirectory()
    }
} else {
    $dialog.SelectedPath = [System.IO.Directory]::GetCurrentDirectory()
}

$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$topForm.Width = 0
$topForm.Height = 0
$topForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen

$result = $dialog.ShowDialog($topForm)
$topForm.Dispose()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
} else {
    Write-Output "CANCELLED"
}
