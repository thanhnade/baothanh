import { useEffect, useState } from "react";
import { ResourceTable } from "../../components/ResourceTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminAPI } from "@/lib/admin-api";
import type { Node, Server } from "@/types/admin";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Loader2, Server as ServerIcon, Network, User, Lock, Settings, CheckCircle2, Search, Eye, FileText, Trash2, Terminal as TerminalIcon, PauseCircle, PlayCircle, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Terminal } from "@/components/common/Terminal";

/**
 * Trang quản lý Nodes
 */
export function Nodes() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [openDetail, setOpenDetail] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [assigningNode, setAssigningNode] = useState<string | null>(null); // Track node đang được assign
  const [joiningNode, setJoiningNode] = useState<string | null>(null); // Track node đang được join
  const [removingNode, setRemovingNode] = useState<string | null>(null); // Track node đang được gỡ khỏi cluster
  const [cordoningNode, setCordoningNode] = useState<string | null>(null); // Track node đang được cordon
  const [uncordoningNode, setUncordoningNode] = useState<string | null>(null); // Track node đang được uncordon
  const [isCordonConfirmOpen, setIsCordonConfirmOpen] = useState(false); // Dialog xác nhận cordon
  const [nodeToCordon, setNodeToCordon] = useState<Node | null>(null); // Node đang chờ xác nhận cordon
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingSsh, setIsTestingSsh] = useState(false);
  const [createMode, setCreateMode] = useState<"create" | "assign">("create");
  const [activeTab, setActiveTab] = useState("connection");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formData, setFormData] = useState({
    name: "",
    ipAddress: "",
    port: "22",
    username: "",
    password: "",
    role: "WORKER",
    serverStatus: "RUNNING",
    clusterStatus: "AVAILABLE",
  });
  // States cho phần gán server đã có
  const [availableServers, setAvailableServers] = useState<Server[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [serverRoles, setServerRoles] = useState<Record<string, string>>({});
  const [assignSearchQuery, setAssignSearchQuery] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  // State cho modal nhập mật khẩu khi node chưa có trong CSDL
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [nodeToCreate, setNodeToCreate] = useState<{
    name: string;
    ip: string;
    role: string;
    port: string;
    username: string;
    password: string;
  } | null>(null);
  const [isCreatingServer, setIsCreatingServer] = useState(false);
  const [allServers, setAllServers] = useState<Server[]>([]);
  // States cho Terminal
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [selectedNodeForTerminal, setSelectedNodeForTerminal] = useState<Node | null>(null);
  const [serverForTerminal, setServerForTerminal] = useState<Server | null>(null);

  // Role limits: MASTER, DOCKER, ANSIBLE chỉ được 1 server, WORKER không giới hạn
  const ROLE_LIMITS = {
    MASTER: 1,
    DOCKER: 1,
    ANSIBLE: 1,
    WORKER: Infinity
  };

  useEffect(() => {
    loadNodes(true);
    loadAllServers();
  }, []);

  const loadAllServers = async () => {
    try {
      const servers = await adminAPI.getServers();
      setAllServers(servers);
    } catch (error) {
      // Silent fail, chỉ dùng để tính role limits
    }
  };

  // Tính toán số lượng server theo role hiện tại
  const roleCounts = allServers.reduce((acc, server) => {
    if (server.role) {
      acc[server.role] = (acc[server.role] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Kiểm tra role có available không (chưa đạt giới hạn)
  const isRoleAvailable = (role: string) => {
    const limit = ROLE_LIMITS[role as keyof typeof ROLE_LIMITS] ?? Infinity;
    const currentCount = roleCounts[role] || 0;
    return currentCount < limit;
  };

  // Lấy thông tin giới hạn cho role
  const getRoleLimitInfo = (role: string) => {
    const limit = ROLE_LIMITS[role as keyof typeof ROLE_LIMITS] ?? Infinity;
    const currentCount = roleCounts[role] || 0;

    if (limit === Infinity) {
      return { limit: "∞", current: currentCount, available: true };
    }

    return {
      limit,
      current: currentCount,
      available: isRoleAvailable(role)
    };
  };

  const loadNodes = async (initial = false) => {
    try {
      if (initial) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const data = await adminAPI.getNodes();
      // Chỉ lưu thông tin cơ bản, không lưu pods, labels, yaml
      const basicNodes = data.map(node => ({
        ...node,
        pods: [],
        labels: {},
        yaml: "",
      }));
      setNodes(basicNodes);
    } catch (error) {
      toast.error("Không thể tải danh sách nodes");
    } finally {
      if (initial) {
        setLoading(false);
      } else {
        setIsRefreshing(false);
        toast.success("Đã làm mới danh sách nodes");
      }
    }
  };

  const handleView = async (node: Node) => {
    // Set node cơ bản ngay lập tức để hiển thị đúng tên node trong modal
    setSelectedNode({
      ...node,
      pods: [],
      labels: {},
      yaml: "",
    });
    setOpenDetail(true);
    setLoadingDetail(true);
    try {
      // Gọi API để lấy chi tiết node đầy đủ
      const nodeDetail = await adminAPI.getNode(node.name);
      setSelectedNode(nodeDetail);
    } catch (error) {
      toast.error("Không thể tải chi tiết node");
      setOpenDetail(false);
      setSelectedNode(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const formatNumber = (value: number, fractionDigits = 2) =>
    Number.isFinite(value) ? value.toFixed(fractionDigits) : "0";

  const formatDate = (value?: string) => {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const handleAdd = async () => {
    setCreateMode("create");
    setActiveTab("connection");
    setFormData({
      name: "",
      ipAddress: "",
      port: "22",
      username: "",
      password: "",
      role: "WORKER",
      serverStatus: "RUNNING",
      clusterStatus: "AVAILABLE",
    });
    setIsCreateDialogOpen(true);
    
    // Load danh sách servers khi mở modal
    await loadAvailableServers();
  };

  const loadAvailableServers = async () => {
    try {
      setLoadingServers(true);
      const allServers = await adminAPI.getServers();
      // Lọc các server chưa được gán vào cluster (clusterStatus !== "AVAILABLE")
      const serversNotInCluster = allServers.filter(
        (server) => server.clusterStatus !== "AVAILABLE"
      );
      setAvailableServers(serversNotInCluster);
    } catch (error) {
      toast.error("Không thể tải danh sách servers");
    } finally {
      setLoadingServers(false);
    }
  };

  const canAssignServerToCluster = (server: Server) => {
    const role = server.role?.toUpperCase() || "";
    return role === "MASTER" || role === "WORKER";
  };

  const handleToggleServer = (serverId: string, checked: boolean) => {
    const server = availableServers.find((s) => s.id === serverId);
    if (!server) return;

    if (!canAssignServerToCluster(server)) {
      toast.error(`Server ${server.name} có role ${server.role} không thể được gán vào cluster. Chỉ có MASTER và WORKER mới được phép.`);
      return;
    }

    const newSelected = new Set(selectedServers);
    if (checked) {
      newSelected.add(serverId);
      if (!serverRoles[serverId]) {
        const currentRole = server?.role?.toUpperCase() || "WORKER";
        const defaultRole = (currentRole === "MASTER" || currentRole === "WORKER")
          ? currentRole
          : "WORKER";
        setServerRoles((prev) => ({ ...prev, [serverId]: defaultRole }));
      }
    } else {
      newSelected.delete(serverId);
    }
    setSelectedServers(newSelected);
  };

  const handleRoleChange = (serverId: string, role: string) => {
    const roleUpper = role.toUpperCase();
    if (roleUpper !== "MASTER" && roleUpper !== "WORKER") {
      toast.error("Chỉ có thể gán server với role MASTER hoặc WORKER vào cluster");
      return;
    }
    setServerRoles((prev) => ({ ...prev, [serverId]: roleUpper }));
  };

  const handleAssignServers = async () => {
    if (selectedServers.size === 0) {
      toast.error("Vui lòng chọn ít nhất một server");
      return;
    }

    try {
      setIsAssigning(true);
      const serverIds = Array.from(selectedServers);

      const updates = serverIds.map((id) => {
        const server = availableServers.find((s) => s.id === id);
        const selectedRole = serverRoles[id] || server?.role?.toUpperCase() || "WORKER";
        const role = (selectedRole === "MASTER" || selectedRole === "WORKER")
          ? selectedRole
          : "WORKER";
        return {
          serverId: id,
          role,
        };
      });

      await adminAPI.assignServersToCluster(updates);
      toast.success(`Đã gán ${serverIds.length} server vào cluster thành công`);
      
      // Reset state
      setSelectedServers(new Set());
      setServerRoles({});
      setAssignSearchQuery("");
      
      // Reload nodes để cập nhật danh sách
      await loadNodes(false);
      
      // Đóng modal hoặc chuyển về tab create
      setCreateMode("create");
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message ||
                          error?.message ||
                          "Không thể gán servers vào cluster";
      toast.error(errorMessage);
    } finally {
      setIsAssigning(false);
    }
  };

  // Filter servers cho phần assign
  const filteredAvailableServers = availableServers.filter((server) => {
    if (assignSearchQuery.trim()) {
      const query = assignSearchQuery.toLowerCase();
      const nameMatch = (server.name || "").toLowerCase().includes(query);
      const ipMatch = (server.ipAddress || "").toLowerCase().includes(query);
      if (!nameMatch && !ipMatch) return false;
    }
    return true;
  });

  const handleTestSsh = async (e: React.MouseEvent) => {
    e.preventDefault();

    const ip = formData.ipAddress;
    const port = parseInt(formData.port) || 22;
    const username = formData.username;
    const password = formData.password;

    if (!ip || !username || !password) {
      toast.error("Vui lòng điền đầy đủ thông tin IP, Username và Password");
      return;
    }

    try {
      setIsTestingSsh(true);
      const result = await adminAPI.testSsh({
        ip,
        port,
        username,
        password,
      });

      if (result.success) {
        toast.success("Kết nối SSH thành công!");
      } else {
        toast.error(result.message || "Kết nối SSH thất bại");
      }
    } catch (error: any) {
      toast.error(error.message || "Lỗi khi test SSH connection");
    } finally {
      setIsTestingSsh(false);
    }
  };

  const handleCreateServer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      const data: any = {
        name: formData.name,
        ipAddress: formData.ipAddress,
        port: parseInt(formData.port) || 22,
        username: formData.username,
        password: formData.password || "",
        role: formData.role || "WORKER",
        serverStatus: formData.serverStatus || "RUNNING",
        clusterStatus: formData.clusterStatus || "AVAILABLE",
        status: "online" as const,
        os: "Unknown",
      };
      
      await adminAPI.createServer(data);
      toast.success("Tạo server thành công. Hệ thống đang tự động cấu hình SSH key và lấy metrics...");
      setIsCreateDialogOpen(false);
      // Reload nodes và servers để cập nhật danh sách và role limits
      await Promise.all([loadNodes(false), loadAllServers()]);
    } catch (error: any) {
      const errorMessage = error.message || 
                          error.response?.data?.message || 
                          error.response?.data?.error || 
                          "Không thể tạo server";
      toast.error(errorMessage);
      console.error("Error creating server:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateUsagePercent = (used: number, total: number): number => {
    if (!Number.isFinite(used) || !Number.isFinite(total) || total === 0) return 0;
    return Math.min(100, Math.max(0, (used / total) * 100));
  };

  const getUsageColor = (percent: number): string => {
    if (percent >= 90) return "bg-red-500";
    if (percent >= 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  const ResourceProgressBar = ({
    label,
    used,
    total,
    unit = "",
  }: {
    label: string;
    used: number;
    total: number;
    unit?: string;
  }) => {
    const percent = calculateUsagePercent(used, total);
    const colorClass = getUsageColor(percent);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground uppercase text-xs">{label}</span>
          <span className="font-medium">
            {formatNumber(used)} / {formatNumber(total)} {unit}
          </span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all duration-300 ${colorClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatNumber(percent)}% sử dụng</span>
          <span>
            {formatNumber(total - used)} {unit} còn lại
          </span>
        </div>
      </div>
    );
  };

  const columns = [
    {
      key: "name",
      label: "Tên",
    },
    {
      key: "ip",
      label: "IP",
      align: "center" as const,
      render: (node: Node) => (
        <span className="text-sm font-mono">
          {node.ip || "-"}
        </span>
      ),
    },
    {
      key: "role",
      label: "Role",
      align: "center" as const,
      render: (node: Node) => (
        <Badge variant="secondary" className="text-xs">
          {node.role}
        </Badge>
      ),
    },
    {
      key: "cpu",
      label: "CPU",
      align: "center" as const,
      render: (node: Node) => (
        <span className="text-sm">
          {node.cpu.requested.toFixed(2)} / {node.cpu.capacity.toFixed(2)}
        </span>
      ),
    },
    {
      key: "memory",
      label: "Memory",
      align: "center" as const,
      render: (node: Node) => (
        <span className="text-sm">
          {node.memory.requested.toFixed(2)} / {node.memory.capacity.toFixed(2)} GB
        </span>
      ),
    },
    {
      key: "disk",
      label: "Disk",
      align: "center" as const,
      render: (node: Node) => (
        <span className="text-sm">
          {node.disk.requested.toFixed(2)} / {node.disk.capacity.toFixed(2)} GB
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      align: "center" as const,
      render: (node: Node) => {
        if (node.status === "NOT_ASSIGN") {
          return (
            <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
              NOT ASSIGN
            </Badge>
          );
        }
        if (node.status === "NOT_JOIN_K8S") {
          return (
            <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
              NOT JOIN K8S
            </Badge>
          );
        }
        return (
          <Badge variant={node.status === "ready" ? "success" : "destructive"}>
            {node.status === "ready" ? "Ready" : "Not Ready"}
          </Badge>
        );
      },
    },
  ];

  // Handler functions for actions
  const handleAssignNode = async (node: Node) => {
                setAssigningNode(node.name);
                try {
                  // Lấy chi tiết node để lấy IP từ yaml
                  const nodeDetail = await adminAPI.getNode(node.name);
                  
      // Parse IP từ yaml hoặc dùng node.ip nếu có
      let nodeIp: string | null = node.ip || null;
      if (!nodeIp && nodeDetail.yaml) {
                    // Tìm InternalIP trong yaml
                    const internalIpMatch = nodeDetail.yaml.match(/type:\s*InternalIP[\s\S]*?address:\s*([0-9.]+)/);
                    if (internalIpMatch && internalIpMatch[1]) {
                      nodeIp = internalIpMatch[1].trim();
                    }
                  }
                  
                  if (!nodeIp) {
                    toast.error(`Không thể lấy IP của node ${node.name}`);
        setAssigningNode(null);
                    return;
                  }
                  
      // Tìm server theo IP hoặc theo tên
                  const servers = await adminAPI.getServers();
      let matchedServer = servers.find(s => s.ipAddress === nodeIp);
                  
      // Nếu không tìm thấy theo IP, thử tìm theo tên
                  if (!matchedServer) {
        matchedServer = servers.find(s => s.name.toLowerCase() === node.name.toLowerCase());
                  }
                  
      // Nếu tìm thấy server trong CSDL → chỉ cập nhật cluster_status
      if (matchedServer) {
                  const serverId = matchedServer.id;
                  let serverRole = matchedServer.role?.toUpperCase() || "WORKER";
                  
                  // Chỉ cho phép MASTER hoặc WORKER khi gán vào cluster
                  if (serverRole !== "MASTER" && serverRole !== "WORKER") {
                    serverRole = "WORKER";
                  }
                  
                  // Gán server vào cluster
                  await adminAPI.assignServersToCluster([{ 
                    serverId: serverId, 
                    role: serverRole
                  }]);
                  
                  toast.success("Đã assign node vào cluster thành công");
                  // Reload danh sách nodes
                  await loadNodes(false);
        setAssigningNode(null);
        return;
      }
      
      // Nếu KHÔNG tìm thấy server trong CSDL → hiển thị modal nhập mật khẩu
      // Lấy role từ node (master/worker)
      const nodeRole = node.role?.toUpperCase() === "MASTER" ? "MASTER" : "WORKER";
      
      setNodeToCreate({
        name: node.name,
        ip: nodeIp,
        role: nodeRole,
        port: "22", // Port mặc định
        username: "",
        password: "",
      });
      setIsPasswordDialogOpen(true);
      setAssigningNode(null);
                } catch (error: any) {
                  const errorMessage = error?.response?.data?.message || 
                                     error?.message || 
                                     "Không thể assign node vào cluster";
                  toast.error(errorMessage);
                  setAssigningNode(null);
                }
  };

  // Handler tạo server mới từ node chưa có trong CSDL
  const handleCreateServerFromNode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!nodeToCreate) return;
    
    if (!nodeToCreate.username || !nodeToCreate.password) {
      toast.error("Vui lòng nhập đầy đủ username và password");
      return;
    }
    
    try {
      setIsCreatingServer(true);
      
      // Tạo server mới với thông tin từ node
      const serverData: any = {
        name: nodeToCreate.name,
        ipAddress: nodeToCreate.ip,
        port: parseInt(nodeToCreate.port) || 22,
        username: nodeToCreate.username,
        password: nodeToCreate.password,
        role: nodeToCreate.role,
        serverStatus: "RUNNING",
        clusterStatus: "AVAILABLE", // Mặc định AVAILABLE khi thêm mới trong Nodes
        status: "online" as const,
        os: "Unknown",
      };
      
      // Tạo server mới (API trả về Server với ID)
      const createdServer = await adminAPI.createServer(serverData);
      
      if (!createdServer || !createdServer.id) {
        toast.error("Tạo server thành công nhưng không nhận được ID server");
        setIsCreatingServer(false);
        return;
      }
      
      // Gán server vừa tạo vào cluster
      await adminAPI.assignServersToCluster([{ 
        serverId: createdServer.id, 
        role: nodeToCreate.role as "MASTER" | "WORKER"
      }]);
      
      toast.success("Đã tạo server và assign vào cluster thành công");
      
      // Đóng modal và reset state
      setIsPasswordDialogOpen(false);
      setNodeToCreate(null);
      
      // Reload danh sách nodes
      await loadNodes(false);
    } catch (error: any) {
      const errorMessage = error.message || 
                          error.response?.data?.message || 
                          error.response?.data?.error || 
                          "Không thể tạo server";
      toast.error(errorMessage);
      console.error("Error creating server from node:", error);
    } finally {
      setIsCreatingServer(false);
    }
  };

  const handleJoinNode = async (node: Node) => {
                setJoiningNode(node.id);
                try {
                  // node.id là server ID khi status là NOT_JOIN_K8S
                  const serverId = node.id;
                  
                  if (!serverId) {
                    toast.error(`Không thể xác định server ID cho node ${node.name}`);
                    return;
                  }
                  
                  // Join node vào K8s cluster
                  await adminAPI.joinNodeToK8s(serverId);
                  
                  toast.success("Đã join node vào K8s cluster thành công");
                  // Reload danh sách nodes
                  await loadNodes(false);
                } catch (error: any) {
                  const errorMessage = error?.response?.data?.message || 
                                     error?.message || 
                                     "Không thể join node vào K8s cluster";
                  toast.error(errorMessage);
                } finally {
                  setJoiningNode(null);
                }
  };

  const handleRemoveFromCluster = async (node: Node) => {
    // Xác nhận trước khi gỡ
    if (!confirm(`Bạn có chắc muốn gỡ node "${node.name}" khỏi cluster?`)) {
      return;
    }

    setRemovingNode(node.name);
    try {
      // Nếu node đã join vào K8s cluster (status ready/notready), sử dụng API mới để xóa an toàn
      if (node.status === "ready" || node.status === "notready") {
        // Sử dụng API mới để xóa node khỏi K8s cluster một cách an toàn (drain, delete)
        // Backend sẽ tự động kiểm tra last master (nếu là MASTER) và thực hiện các bước an toàn
        // Worker nodes có thể được gỡ hoàn toàn (không giới hạn)
        // Truyền IP nếu có để tối ưu (không cần query lại từ K8s)
        await adminAPI.removeNodeFromK8s(node.name, node.ip);
        toast.success(`Đã xóa node ${node.name} khỏi K8s cluster thành công`);
      } else {
        // Với node chưa join K8s (NOT_JOIN_K8S hoặc NOT_ASSIGN), chỉ cần unassign server khỏi cluster
        let serverId: string | null = null;
        let matchedServer: Server | null = null;

        // Với node có status "NOT_JOIN_K8S", node.id là server ID
        if (node.status === "NOT_JOIN_K8S") {
          serverId = node.id;
          // Tìm server để kiểm tra role
          const servers = await adminAPI.getServers();
          matchedServer = servers.find(s => s.id === serverId) || null;
        } else if (node.status === "NOT_ASSIGN") {
          // Với node NOT_ASSIGN, tìm server theo IP
          // Ưu tiên dùng node.ip nếu có (đã được set từ backend)
          let nodeIp: string | null = node.ip || null;
          
          // Nếu không có IP từ node, thử lấy từ detail yaml (fallback)
          if (!nodeIp) {
            try {
              const nodeDetail = await adminAPI.getNode(node.name);
              if (nodeDetail.yaml) {
                const internalIpMatch = nodeDetail.yaml.match(/type:\s*InternalIP[\s\S]*?address:\s*([0-9.]+)/);
                if (internalIpMatch && internalIpMatch[1]) {
                  nodeIp = internalIpMatch[1].trim();
                }
              }
            } catch (error) {
              console.warn("Không thể lấy node detail để parse IP:", error);
            }
          }
          
          if (!nodeIp) {
            toast.error(`Không thể lấy IP của node ${node.name}`);
            return;
          }
          
          // Tìm server theo IP
          const servers = await adminAPI.getServers();
          matchedServer = servers.find(s => s.ipAddress === nodeIp) || null;
          
          if (!matchedServer) {
            toast.error(`Không tìm thấy server với IP ${nodeIp} tương ứng với node ${node.name}`);
            return;
          }
          
          serverId = matchedServer.id;
        }
        
        if (!serverId) {
          toast.error(`Không thể xác định server ID cho node ${node.name}`);
          return;
        }
        
        // Kiểm tra nếu đang xóa MASTER cuối cùng (cho cả NOT_JOIN_K8S và NOT_ASSIGN)
        if (matchedServer && matchedServer.role === "MASTER") {
          const servers = await adminAPI.getServers();
          const serversInCluster = servers.filter(s => s.clusterStatus === "AVAILABLE");
          const masterCount = serversInCluster.filter(s => s.role === "MASTER").length;
          if (masterCount === 1) {
            toast.error("Không thể bỏ server MASTER này. Phải có ít nhất 1 MASTER trong cluster.");
            return;
          }
        }
        
        // Gỡ server khỏi cluster
        await adminAPI.unassignServersFromCluster([serverId]);
        toast.success(`Đã gỡ node ${node.name} khỏi cluster thành công`);
      }
      
      // Reload danh sách nodes
      await loadNodes(false);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || 
                         error?.response?.data?.error ||
                         error?.message || 
                         "Không thể gỡ node khỏi cluster";
      toast.error(errorMessage);
    } finally {
      setRemovingNode(null);
    }
  };

  // Handler cordon node - với cảnh báo nếu là master node
  const handleCordonNode = async (node: Node) => {
    // Kiểm tra nếu là master node, hiển thị confirmation dialog
    const isMasterNode = node.role?.toLowerCase() === "master";
    
    if (isMasterNode) {
      setNodeToCordon(node);
      setIsCordonConfirmOpen(true);
      return;
    }
    
    // Nếu không phải master, thực hiện cordon ngay
    await performCordonNode(node);
  };

  // Thực hiện cordon node
  const performCordonNode = async (node: Node) => {
    setCordoningNode(node.name);
    try {
      await adminAPI.cordonNode(node.name);
      toast.success(`Đã ngừng nhận Pods cho node ${node.name}`);
      await loadNodes(false);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Không thể cordon node";
      toast.error(errorMessage);
    } finally {
      setCordoningNode(null);
    }
  };

  // Xác nhận cordon master node
  const handleConfirmCordon = async () => {
    if (nodeToCordon) {
      setIsCordonConfirmOpen(false);
      await performCordonNode(nodeToCordon);
      setNodeToCordon(null);
    }
  };

  // Hủy cordon master node
  const handleCancelCordon = () => {
    setIsCordonConfirmOpen(false);
    setNodeToCordon(null);
  };

  // Handler uncordon node
  const handleUncordonNode = async (node: Node) => {
    setUncordoningNode(node.name);
    try {
      await adminAPI.uncordonNode(node.name);
      toast.success(`Đã cho phép nhận Pods cho node ${node.name}`);
      await loadNodes(false);
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Không thể uncordon node";
      toast.error(errorMessage);
    } finally {
      setUncordoningNode(null);
    }
  };

  // Handler mở Terminal
  const handleOpenTerminal = async (node: Node) => {
    try {
      // Tìm server tương ứng với node
      let matchedServer: Server | null = null;
      
      // Nếu node có ID (server ID) và status là NOT_JOIN_K8S, dùng ID để tìm
      if (node.id && node.status === "NOT_JOIN_K8S") {
        matchedServer = allServers.find(s => s.id === node.id) || null;
      }
      
      // Nếu không tìm thấy, thử tìm theo IP
      if (!matchedServer && node.ip) {
        matchedServer = allServers.find(s => s.ipAddress === node.ip) || null;
      }
      
      // Nếu không tìm thấy, thử tìm theo tên
      if (!matchedServer && node.name) {
        matchedServer = allServers.find(s => s.name.toLowerCase() === node.name.toLowerCase()) || null;
      }
      
      if (!matchedServer) {
        toast.error(`Không tìm thấy server tương ứng với node ${node.name}. Vui lòng đảm bảo node đã được assign vào cluster.`);
        return;
      }
      
      // Kiểm tra server có online không
      if (matchedServer.status !== "online") {
        toast.error(`Server ${matchedServer.name} đang offline. Không thể mở terminal.`);
        return;
      }
      
      setSelectedNodeForTerminal(node);
      setServerForTerminal(matchedServer);
      setTerminalOpen(true);
    } catch (error: any) {
      toast.error("Không thể mở terminal: " + (error.message || "Lỗi không xác định"));
    }
  };

  const renderCustomActions = (node: Node) => (
    <>
      <DropdownMenuItem onClick={() => handleView(node)}>
        <Eye className="mr-2 h-4 w-4" />
        Chi tiết
      </DropdownMenuItem>
      {/* Terminal - chỉ hiển thị cho nodes đã có server tương ứng */}
      {(node.status === "ready" || node.status === "notready" || node.status === "NOT_JOIN_K8S") && (
        <DropdownMenuItem onClick={() => handleOpenTerminal(node)}>
          <TerminalIcon className="mr-2 h-4 w-4" />
          Mở Terminal
        </DropdownMenuItem>
      )}
      {/* Cordon/Uncordon - chỉ hiển thị cho nodes đã join K8s (ready/notready) */}
      {(node.status === "ready" || node.status === "notready") && (
        <>
          {!node.unschedulable ? (
            <DropdownMenuItem
              onClick={() => handleCordonNode(node)}
              disabled={cordoningNode === node.name}
            >
              {cordoningNode === node.name ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang ngừng...
                </>
              ) : (
                <>
                  <PauseCircle className="mr-2 h-4 w-4" />
                  Ngừng nhận Pods
                </>
              )}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => handleUncordonNode(node)}
              disabled={uncordoningNode === node.name}
            >
              {uncordoningNode === node.name ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang bật lại...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Cho phép nhận Pods
                </>
              )}
            </DropdownMenuItem>
          )}
        </>
      )}
      {node.status === "NOT_ASSIGN" && (
        <DropdownMenuItem 
          onClick={() => handleAssignNode(node)}
          disabled={assigningNode === node.name}
        >
          {assigningNode === node.name ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang ASSIGN...
            </>
          ) : (
            <>
              <Network className="mr-2 h-4 w-4" />
              ASSIGN
            </>
          )}
        </DropdownMenuItem>
      )}
      {node.status === "NOT_JOIN_K8S" && (
        <DropdownMenuItem 
          onClick={() => handleJoinNode(node)}
          disabled={joiningNode === node.id}
        >
          {joiningNode === node.id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang JOIN...
                </>
              ) : (
            <>
              <Network className="mr-2 h-4 w-4" />
              JOIN K8S
            </>
          )}
        </DropdownMenuItem>
      )}
      {/* Hiển thị "Gỡ khỏi cụm" khi node đã được gán vào cluster (status khác NOT_ASSIGN) */}
      {node.status !== "NOT_ASSIGN" && (
        <DropdownMenuItem 
          onClick={() => handleRemoveFromCluster(node)}
          disabled={removingNode === node.name}
          className="text-destructive focus:text-destructive"
        >
          {removingNode === node.name ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Đang gỡ...
            </>
          ) : (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              Gỡ khỏi cụm
            </>
          )}
        </DropdownMenuItem>
      )}
    </>
  );

  // Helper functions for filter labels
  const getRoleLabel = (value: string) => {
    if (value === "all") return "Tất cả role";
    return value;
  };

  const getStatusLabel = (value: string) => {
    switch (value) {
      case "all":
        return "Tất cả trạng thái";
      case "ready":
        return "Ready";
      case "notready":
        return "Not Ready";
      case "NOT_ASSIGN":
        return "NOT ASSIGN";
      case "NOT_JOIN_K8S":
        return "NOT JOIN K8S";
      default:
        return value;
    }
  };

  // Get unique roles from nodes
  const roleOptions = Array.from(new Set(nodes.map((node) => node.role).filter(Boolean))).sort();

  // Filter logic
  const filteredNodes = nodes.filter((node) => {
    // Search filter
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase();
      const nameMatch = node.name.toLowerCase().includes(query);
      if (!nameMatch) return false;
    }

    // Role filter
    if (roleFilter !== "all") {
      if (node.role !== roleFilter) return false;
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "ready" && node.status !== "ready") return false;
      if (statusFilter === "notready" && node.status !== "notready") return false;
      if (statusFilter === "NOT_ASSIGN" && node.status !== "NOT_ASSIGN") return false;
      if (statusFilter === "NOT_JOIN_K8S" && node.status !== "NOT_JOIN_K8S") return false;
    }

    return true;
  });

  const totalCount = nodes.length;
  const filteredCount = filteredNodes.length;
  const tableTitle =
    filteredCount === totalCount
      ? `Danh sách Nodes (${totalCount})`
      : `Danh sách Nodes (${filteredCount}/${totalCount})`;

  const filterToolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Tìm kiếm node..."
          className="pl-9"
        />
      </div>
      <div className="w-full sm:w-48">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger>
            <SelectValue>{getRoleLabel(roleFilter)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả role</SelectItem>
            {roleOptions.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full sm:w-48">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue>{getStatusLabel(statusFilter)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả trạng thái</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="notready">Not Ready</SelectItem>
            <SelectItem value="NOT_ASSIGN">NOT ASSIGN</SelectItem>
            <SelectItem value="NOT_JOIN_K8S">NOT JOIN K8S</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
          variant="outline"
          onClick={() => loadNodes(false)}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Đang làm mới...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Làm mới
            </>
          )}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <ResourceTable
        title={tableTitle}
        columns={columns}
        data={filteredNodes}
        loading={loading}
        onAdd={handleAdd}
        customActions={renderCustomActions}
        hideSearch
        toolbarContent={filterToolbar}
        emptyMessage="Không tìm thấy node phù hợp"
      />
      <Dialog open={openDetail} onOpenChange={(open) => {
        setOpenDetail(open);
        if (!open) {
          // Clear selectedNode khi đóng modal
          setSelectedNode(null);
          setLoadingDetail(false);
        }
      }}>
        <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Chi tiết node {selectedNode?.name || "..."}</DialogTitle>
            <DialogDescription>
              Trạng thái tổng quan về tài nguyên và thông tin hệ thống của node.
            </DialogDescription>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Đang tải chi tiết node...</div>
            </div>
          ) : selectedNode ? (
            <div className="max-h-[calc(90vh-140px)] overflow-y-auto pr-1">
              <Tabs defaultValue="info" className="space-y-6">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="resources">Resource</TabsTrigger>
                  <TabsTrigger value="pods">Pods</TabsTrigger>
                  <TabsTrigger value="labels">Labels</TabsTrigger>
                  <TabsTrigger value="yaml">YAML</TabsTrigger>
                </TabsList>

                <TabsContent value="info">
                <div className="rounded-md border p-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Node Name</div>
                      <div className="mt-1 text-sm font-semibold">{selectedNode.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Role</div>
                      <Badge variant="secondary" className="mt-1">
                        {selectedNode.role}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Status</div>
                      {selectedNode.status === "NOT_ASSIGN" ? (
                        <Badge
                          variant="secondary"
                          className="mt-1 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
                        >
                          NOT ASSIGN
                        </Badge>
                      ) : selectedNode.status === "NOT_JOIN_K8S" ? (
                        <Badge
                          variant="secondary"
                          className="mt-1 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
                        >
                          NOT JOIN K8S
                        </Badge>
                      ) : (
                        <Badge
                          variant={selectedNode.status === "ready" ? "success" : "destructive"}
                          className="mt-1"
                        >
                          {selectedNode.status === "ready" ? "Ready" : "Not Ready"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">CPU</div>
                      <div className="mt-1 text-sm font-medium">
                        {formatNumber(selectedNode.cpu.capacity)} vCPU
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">RAM</div>
                      <div className="mt-1 text-sm font-medium">
                        {formatNumber(selectedNode.memory.capacity)} GB
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Operating System</div>
                      <div className="mt-1 text-sm font-medium">{selectedNode.os ?? "Unknown"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Kubelet</div>
                      <div className="mt-1 text-sm font-medium">
                        {selectedNode.kubeletVersion ?? "Unknown"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Container Runtime</div>
                      <div className="mt-1 text-sm font-medium">
                        {selectedNode.containerRuntime ?? "Unknown"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Updated</div>
                      <div className="mt-1 text-sm">{formatDate(selectedNode.updatedAt)}</div>
                    </div>
                  </div>
                </div>
              </TabsContent>

                <TabsContent value="resources" className="space-y-6">
                <section className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-3">
                    <div className="rounded-md border p-5 space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase mb-1">CPU (cores)</div>
                        <div className="text-sm text-muted-foreground">
                          Allocatable: {formatNumber(selectedNode.cpu.limit)} | Capacity: {formatNumber(selectedNode.cpu.capacity)}
                        </div>
                      </div>
                      <ResourceProgressBar
                        label="CPU Usage"
                        used={selectedNode.cpu.requested}
                        total={selectedNode.cpu.limit}
                        unit="cores"
                      />
                    </div>
                    <div className="rounded-md border p-5 space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase mb-1">Memory (GB)</div>
                        <div className="text-sm text-muted-foreground">
                          Allocatable: {formatNumber(selectedNode.memory.limit)} | Capacity: {formatNumber(selectedNode.memory.capacity)}
                        </div>
                      </div>
                      <ResourceProgressBar
                        label="Memory Usage"
                        used={selectedNode.memory.requested}
                        total={selectedNode.memory.limit}
                        unit="GB"
                      />
                    </div>
                    <div className="rounded-md border p-5 space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase mb-1">Disk (GB)</div>
                        <div className="text-sm text-muted-foreground">
                          Capacity: {formatNumber(selectedNode.disk.capacity)}
                        </div>
                      </div>
                      <ResourceProgressBar
                        label="Disk Usage"
                        used={selectedNode.disk.requested}
                        total={selectedNode.disk.capacity}
                        unit="GB"
                      />
                    </div>
                  </div>
                </section>
              </TabsContent>

                <TabsContent value="pods">
                {selectedNode.pods && selectedNode.pods.length > 0 ? (
                  <div className="rounded-md border">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-2 text-left">Tên</th>
                            <th className="px-4 py-2 text-left">Namespace</th>
                            <th className="px-4 py-2 text-left">Status</th>
                            <th className="px-4 py-2 text-left">IP</th>
                            <th className="px-4 py-2 text-left">Age</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedNode.pods.map((pod) => (
                            <tr key={`${pod.namespace}-${pod.name}`} className="border-t">
                              <td className="px-4 py-2 font-medium">{pod.name}</td>
                              <td className="px-4 py-2">{pod.namespace}</td>
                              <td className="px-4 py-2 capitalize">{pod.status}</td>
                              <td className="px-4 py-2">{pod.ip ?? "-"}</td>
                              <td className="px-4 py-2">{pod.age ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                    Node chưa có danh sách pods hoặc dữ liệu chưa được đồng bộ.
                  </div>
                )}
              </TabsContent>

                <TabsContent value="labels">
                {selectedNode.labels && Object.keys(selectedNode.labels).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedNode.labels).map(([key, value]) => (
                      <Badge key={key} variant="secondary">
                        {key}: {value}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                    Node chưa có labels hiển thị.
                  </div>
                )}
              </TabsContent>

                <TabsContent value="yaml">
                <div className="rounded-md border bg-muted/40 p-4">
                  <pre className="max-h-80 overflow-auto text-xs">
                    {selectedNode.yaml ? selectedNode.yaml : "Chưa có YAML cho node này."}
                  </pre>
                </div>
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog tạo host mới hoặc gán host đã có */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
        setIsCreateDialogOpen(open);
        if (!open) {
          setCreateMode("create");
          setActiveTab("connection");
          setFormData({
            name: "",
            ipAddress: "",
            port: "22",
            username: "",
            password: "",
            role: "WORKER",
            serverStatus: "RUNNING",
            clusterStatus: "AVAILABLE",
          });
          setSelectedServers(new Set());
          setServerRoles({});
          setAssignSearchQuery("");
        }
      }}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <ServerIcon className="h-6 w-6" />
              {createMode === "create" ? "Thêm host mới" : "Gán host đã có"}
            </DialogTitle>
            <DialogDescription className="mt-2">
              {createMode === "create"
                ? "Nhập thông tin kết nối SSH để hệ thống tự động cấu hình và quản lý host"
                : "Chọn các hosts chưa nằm trong cluster để gán vào cluster. Chỉ có thể gán hosts với role MASTER hoặc WORKER."}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={createMode} onValueChange={async (value) => {
            setCreateMode(value as "create" | "assign");
            // Load servers khi chuyển sang tab "assign"
            if (value === "assign") {
              await loadAvailableServers();
            }
          }} className="flex flex-col flex-grow overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
              <TabsTrigger value="create">Tạo host mới</TabsTrigger>
              <TabsTrigger value="assign">Gán host đã có</TabsTrigger>
            </TabsList>
          
            {/* Tab 1: Tạo host mới */}
            <TabsContent value="create" className="flex-1 flex flex-col overflow-hidden mt-4">
              <form onSubmit={handleCreateServer} className="flex flex-col flex-1 min-h-0 space-y-4">
                {/* Tên host - hiển thị ở trên cùng, không trong tab */}
                <div className="space-y-2 flex-shrink-0">
              <Label htmlFor="name" className="text-sm font-medium flex items-center gap-2">
                <ServerIcon className="h-3.5 w-3.5" />
                    Host Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="host-01, master-node, worker-01..."
                className="h-10"
                required
              />
              <p className="text-xs text-muted-foreground">
                    Tên hiển thị để dễ dàng nhận biết host
              </p>
    </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex flex-col flex-1 min-h-0">
              <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
                <TabsTrigger value="connection" className="flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Thông tin kết nối
                </TabsTrigger>
                <TabsTrigger value="configuration" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                      Vai trò
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Thông tin kết nối SSH */}
              <TabsContent value="connection" className="space-y-4 mt-4 flex-1 overflow-y-auto min-h-0 pr-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ipAddress" className="text-sm font-medium flex items-center gap-2">
                      <Network className="h-3.5 w-3.5" />
                      IP Address <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="ipAddress"
                      name="ipAddress"
                      type="text"
                      value={formData.ipAddress}
                      onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                      placeholder="192.168.1.10"
                      className="h-10 font-mono"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Địa chỉ IP hoặc hostname
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="port" className="text-sm font-medium">
                      Port SSH <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="port"
                      name="port"
                      type="number"
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                      placeholder="22"
                      className="h-10"
                      min="1"
                      max="65535"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Port SSH (mặc định: 22)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-sm font-medium flex items-center gap-2">
                      <User className="h-3.5 w-3.5" />
                      Username <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="username"
                      name="username"
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      placeholder="root, ubuntu..."
                      className="h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Tên người dùng SSH
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5" />
                      Password <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="••••••••"
                      className="h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Password sẽ được dùng để tự động tạo SSH key
                    </p>
                  </div>
                </div>
              </TabsContent>  

                  {/* Tab 2: Cấu hình Host */}
              <TabsContent value="configuration" className="space-y-4 mt-4 flex-1 overflow-y-auto min-h-0 pr-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="role" className="text-sm font-medium">
                      Role <span className="text-destructive">*</span>
                    </Label>
                    <select
                      id="role"
                      name="role"
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      required
                    >
                          <option
                            value="MASTER"
                            disabled={!isRoleAvailable("MASTER")}
                            title={!isRoleAvailable("MASTER") ? `Đã đạt giới hạn tối đa 1 Master Node` : "Master Node - Điều khiển cluster Kubernetes"}
                          >
                            MASTER - Master Node {getRoleLimitInfo("MASTER").current > 0 && !isRoleAvailable("MASTER") ? "(Đã có)" : ""}
                          </option>
                          <option
                            value="WORKER"
                            disabled={!isRoleAvailable("WORKER")}
                            title="Worker Node - Chạy workloads trong cluster Kubernetes"
                          >
                            WORKER - Worker Node (Không giới hạn)
                          </option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                          Vai trò của host trong hệ thống
                    </p>
                  </div>
                <div className="space-y-2">
                  <Label htmlFor="clusterStatus" className="text-sm font-medium">
                    Cluster Status <span className="text-destructive">*</span>
                  </Label>
                  <select
                    id="clusterStatus"
                    name="clusterStatus"
                    value={formData.clusterStatus}
                    onChange={(e) => setFormData({ ...formData, clusterStatus: e.target.value })}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    required
                  >
                    <option value="AVAILABLE">AVAILABLE - Sẵn sàng trong cluster</option>
                    <option value="UNAVAILABLE">UNAVAILABLE - Không sẵn sàng</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Trạng thái tham gia vào Kubernetes cluster
                  </p>
                </div>
                    </div>
                    {/* Thông báo giới hạn role */}
                    {/* {!isRoleAvailable("MASTER") && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Giới hạn số lượng host:</strong>
                      <ul className="mt-1 ml-4 space-y-1">
                        <li>
                          • MASTER: Đã có {getRoleLimitInfo("MASTER").current}/1 host (đã đạt giới hạn)
                        </li>
                      </ul>
                    </div>
                  </div>
                )} */}
              </TabsContent>
            </Tabs>

            {/* Footer buttons */}
            <div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
              {/* Test SSH Button */}
              <Button
                type="button"
                variant="outline"
                onClick={handleTestSsh}
                disabled={isTestingSsh || isSubmitting}
                className="min-w-[160px]"
              >
                {isTestingSsh ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang kiểm tra...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Kiểm tra kết nối SSH
                  </>
                )}
              </Button>
              
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  className="min-w-[100px]"
                  disabled={isSubmitting || isTestingSsh}
                >
                  Hủy
                </Button>
                <Button type="submit" className="min-w-[120px]" disabled={isSubmitting || isTestingSsh}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Đang tạo...
                    </>
                  ) : (
                    <>
                      <ServerIcon className="mr-2 h-4 w-4" />
                          Thêm host
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
          </TabsContent>

            {/* Tab 2: Gán host đã có */}
          <TabsContent value="assign" className="flex-1 flex flex-col overflow-hidden mt-4">
            <div className="flex-1 flex flex-col space-y-4">
              {/* Search trong modal */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm kiếm server..."
                  value={assignSearchQuery}
                  onChange={(e) => setAssignSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Danh sách servers chưa trong cluster */}
              <div className="border rounded-lg overflow-hidden flex-1 flex flex-col min-h-0">
                <div className="overflow-y-auto flex-1" style={{ maxHeight: "400px" }}>
                  {loadingServers ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      <span className="text-sm text-muted-foreground">Đang tải danh sách servers...</span>
                    </div>
                  ) : filteredAvailableServers.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      {availableServers.length === 0
                        ? "Không có server nào chưa trong cluster"
                        : "Không tìm thấy server nào"}
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-3 text-left w-12">
                            <Checkbox
                              checked={
                                filteredAvailableServers.filter((s) => canAssignServerToCluster(s)).length > 0 &&
                                filteredAvailableServers
                                  .filter((s) => canAssignServerToCluster(s))
                                  .every((s) => selectedServers.has(s.id))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const assignableServers = filteredAvailableServers.filter((s) => canAssignServerToCluster(s));
                                  const allIds = new Set(assignableServers.map((s) => s.id));
                                  setSelectedServers(allIds);
                                  const roles: Record<string, string> = { ...serverRoles };
                                  assignableServers.forEach((s) => {
                                    if (!roles[s.id]) {
                                      const currentRole = s.role?.toUpperCase() || "WORKER";
                                      const role = (currentRole === "MASTER" || currentRole === "WORKER")
                                        ? currentRole
                                        : "WORKER";
                                      roles[s.id] = role;
                                    }
                                  });
                                  setServerRoles(roles);
                                } else {
                                  setSelectedServers(new Set());
                                }
                              }}
                            />
                          </th>
                          <th className="p-3 text-left">Tên</th>
                          <th className="p-3 text-left">IP Address</th>
                          <th className="p-3 text-left">Port</th>
                          <th className="p-3 text-left">Role</th>
                          <th className="p-3 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAvailableServers.map((server) => {
                          const canAssign = canAssignServerToCluster(server);
                          return (
                            <tr
                              key={server.id}
                                className={`border-t ${!canAssign
                                  ? "opacity-50 bg-muted/20"
                                  : selectedServers.has(server.id)
                                  ? "bg-muted/30 hover:bg-muted/50"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <td className="p-3">
                                <Checkbox
                                  checked={selectedServers.has(server.id)}
                                  onChange={(e) => handleToggleServer(server.id, e.target.checked)}
                                  disabled={!canAssign}
                                />
                              </td>
                              <td className="p-3 font-medium">
                                {server.name}
                                {!canAssign && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    (Không thể gán vào cluster)
                                  </span>
                                )}
                              </td>
                              <td className="p-3 font-mono text-sm">{server.ipAddress}</td>
                              <td className="p-3">{server.port}</td>
                              <td className="p-3">
                                {selectedServers.has(server.id) && canAssign ? (
                                  <select
                                    value={serverRoles[server.id] || server.role?.toUpperCase() || "WORKER"}
                                    onChange={(e) => handleRoleChange(server.id, e.target.value)}
                                      className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-w-[120px] ${(serverRoles[server.id] || server.role?.toUpperCase() || "WORKER") === "MASTER"
                                        ? "border-yellow-500/50 bg-yellow-500/5"
                                        : "border-blue-500/50 bg-blue-500/5"
                                    }`}
                                  >
                                    <option value="MASTER">MASTER</option>
                                    <option value="WORKER">WORKER</option>
                                  </select>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    {server.role && (server.role.toUpperCase() === "MASTER" || server.role.toUpperCase() === "WORKER") ? (
                                      <Badge
                                        variant="outline"
                                          className={`text-xs font-medium ${server.role.toUpperCase() === "MASTER"
                                            ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-500"
                                            : "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-500"
                                        }`}
                                      >
                                        {server.role.toUpperCase()}
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs font-medium opacity-50"
                                      >
                                        {server.role?.toUpperCase() || "N/A"}
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-3">
                                <Badge variant={server.status === "online" ? "default" : "secondary"}>
                                  {server.status}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Footer với thông tin và nút */}
              <div className="flex items-center justify-between pt-4 border-t flex-shrink-0">
                <div className="text-sm text-muted-foreground">
                  Đã chọn: {selectedServers.size} server
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    disabled={isAssigning}
                  >
                    Hủy
                  </Button>
                  <Button
                    onClick={handleAssignServers}
                    disabled={isAssigning || selectedServers.size === 0}
                  >
                    {isAssigning ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Đang gán...
                      </>
                    ) : (
                      <>
                        <ServerIcon className="h-4 w-4 mr-2" />
                        Gán vào cluster ({selectedServers.size})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        </DialogContent>
      </Dialog>

      {/* Dialog nhập mật khẩu khi node chưa có trong CSDL */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={(open) => {
        setIsPasswordDialogOpen(open);
        if (!open) {
          setNodeToCreate(null);
        }
      }}>
        <DialogContent className="w-[95vw] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <ServerIcon className="h-6 w-6" />
              Nhập thông tin SSH để tạo host
            </DialogTitle>
            <DialogDescription className="mt-2">
              Node "{nodeToCreate?.name}" chưa có trong hệ thống. Vui lòng nhập thông tin SSH để tạo host mới và gán vào cluster.
            </DialogDescription>
          </DialogHeader>
          
          {nodeToCreate && (
            <form onSubmit={handleCreateServerFromNode} className="space-y-4">
              <div className="space-y-4">
                {/* Thông tin đã có - chỉ hiển thị, không cho chỉnh sửa */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Tên Server</Label>
                    <Input
                      value={nodeToCreate.name}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">IP Address</Label>
                    <Input
                      value={nodeToCreate.ip}
                      disabled
                      className="bg-muted cursor-not-allowed font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Port SSH</Label>
                    <Input
                      value={nodeToCreate.port}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Role</Label>
                    <Input
                      value={nodeToCreate.role}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Cluster Status</Label>
                  <Input
                    value="UNAVAILABLE (sẽ được gán vào cluster sau khi tạo)"
                    disabled
                    className="bg-muted cursor-not-allowed text-xs"
                  />
                </div>

                <div className="border-t pt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ssh-username" className="text-sm font-medium flex items-center gap-2">
                      <User className="h-3.5 w-3.5" />
                      Username SSH <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="ssh-username"
                      value={nodeToCreate.username}
                      onChange={(e) => setNodeToCreate({ ...nodeToCreate, username: e.target.value })}
                      placeholder="root, ubuntu..."
                      className="h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Tên người dùng SSH để kết nối đến server
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ssh-password" className="text-sm font-medium flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5" />
                      Password SSH <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="ssh-password"
                      type="password"
                      value={nodeToCreate.password}
                      onChange={(e) => setNodeToCreate({ ...nodeToCreate, password: e.target.value })}
                      placeholder="••••••••"
                      className="h-10"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Password sẽ được dùng để tự động tạo SSH key và quản lý server
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsPasswordDialogOpen(false)}
                  disabled={isCreatingServer}
                >
                  Hủy
                </Button>
                <Button type="submit" disabled={isCreatingServer}>
                  {isCreatingServer ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Đang tạo và gán...
                    </>
                  ) : (
                    <>
                      <ServerIcon className="mr-2 h-4 w-4" />
                      Tạo host và Gán vào Cluster
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Terminal Dialog */}
      {serverForTerminal && (
        <Terminal
          open={terminalOpen}
          onClose={() => {
            setTerminalOpen(false);
            setSelectedNodeForTerminal(null);
            setServerForTerminal(null);
          }}
          server={{
            id: serverForTerminal.id,
            name: serverForTerminal.name,
            ipAddress: serverForTerminal.ipAddress,
            port: serverForTerminal.port,
            username: serverForTerminal.username,
          }}
        />
      )}

      {/* Confirmation Dialog cho Cordon Master Node */}
      <Dialog open={isCordonConfirmOpen} onOpenChange={setIsCordonConfirmOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              Cảnh báo: Cordon Master Node
            </DialogTitle>
            <DialogDescription className="pt-2">
              Bạn có chắc chắn muốn ngừng nhận Pods cho Master Node này?
            </DialogDescription>
          </DialogHeader>
          {nodeToCordon && (
            <div className="py-4 space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium text-amber-900">
                      Master Node: <span className="font-semibold">{nodeToCordon.name}</span>
                    </p>
                    <div className="text-sm text-amber-800 space-y-1">
                      <p className="font-medium">⚠️ Lưu ý quan trọng:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Master Node chạy các system pods quan trọng (etcd, kube-apiserver, kube-controller-manager, kube-scheduler)</li>
                        <li>Cordon Master Node sẽ ngăn các pods mới được schedule vào node này</li>
                        <li>Pods hiện có vẫn tiếp tục chạy, nhưng không có pods mới nào được tạo trên node này</li>
                        <li>Hành động này có thể ảnh hưởng đến hoạt động của cluster nếu không cẩn thận</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span>Chỉ thực hiện khi bạn chắc chắn về mục đích bảo trì hoặc cấu hình.</span>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCancelCordon}>
              Hủy
            </Button>
            <Button
              onClick={handleConfirmCordon}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Xác nhận Cordon
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

