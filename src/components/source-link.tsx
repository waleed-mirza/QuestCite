import { projectConfig } from "@/config/project";

/** Header and hero link to the public source repository. */
export function SourceLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={projectConfig.repositoryUrl} rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
