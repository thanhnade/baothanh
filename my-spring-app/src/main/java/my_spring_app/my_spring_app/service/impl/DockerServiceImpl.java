package my_spring_app.my_spring_app.service.impl;

import my_spring_app.my_spring_app.dto.reponse.AnsibleOperationResponse;
import my_spring_app.my_spring_app.dto.reponse.AnsibleTaskStatusResponse;
import my_spring_app.my_spring_app.dto.reponse.DockerStatusResponse;
import my_spring_app.my_spring_app.dto.request.InstallDockerRequest;
import my_spring_app.my_spring_app.dto.request.DockerLoginRequest;
import my_spring_app.my_spring_app.entity.ServerEntity;
import my_spring_app.my_spring_app.repository.ServerRepository;
import my_spring_app.my_spring_app.service.DockerService;
import my_spring_app.my_spring_app.service.ServerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Service implementation cho Docker
 * Xử lý các nghiệp vụ liên quan đến quản lý Docker
 */
@Service
public class DockerServiceImpl implements DockerService {

    private static final Logger logger = LoggerFactory.getLogger(DockerServiceImpl.class);

    @Autowired
    private ServerRepository serverRepository;

    @Autowired
    private ServerService serverService;

    // Cache để lưu trữ trạng thái các task Docker
    private final ConcurrentMap<String, DockerTaskStatus> taskCache = new ConcurrentHashMap<>();

    /**
     * Class để lưu trữ trạng thái task Docker
     */
    private static class DockerTaskStatus {
        private final String taskId;
        private final StringBuilder logs = new StringBuilder();
        private final long startTime = System.currentTimeMillis();
        private volatile Long endTime;
        private volatile String status = "running"; // running, completed, failed
        private volatile int currentStep = 0; // Bước hiện tại (1-5 cho install, 1-4 cho uninstall)
        private volatile String error;

        DockerTaskStatus(String taskId) {
            this.taskId = taskId;
        }

        synchronized void appendLog(String text) {
            logs.append(text);
        }

        synchronized String snapshotLogs() {
            return logs.toString();
        }

        void setCurrentStep(int step) {
            this.currentStep = step;
        }

        void markCompleted(String message) {
            this.status = "completed";
            this.endTime = System.currentTimeMillis();
            if (message != null && !message.isBlank()) {
                appendLog("✅ " + message + (message.endsWith("\n") ? "" : "\n"));
            }
        }

        void markFailed(String message, int failedStep) {
            this.status = "failed";
            this.error = message;
            this.endTime = System.currentTimeMillis();
            this.currentStep = failedStep;
            if (message != null && !message.isBlank()) {
                appendLog("❌ Buoc " + failedStep + " that bai: " + message + (message.endsWith("\n") ? "" : "\n"));
            }
        }

        String getStatus() { return status; }
        int getCurrentStep() { return currentStep; }
        long getStartTime() { return startTime; }
        Long getEndTime() { return endTime; }
        String getError() { return error; }
    }

    /**
     * Tìm server Docker (role = "DOCKER")
     * Tận dụng ServerService để kiểm tra ping nếu cần
     */
    private ServerEntity findDockerServer() {
        // Tìm server có role là DOCKER và đang online
        Optional<ServerEntity> dockerServer = serverRepository.findAll().stream()
            .filter(server -> "DOCKER".equals(server.getRole()) && server.getStatus() == ServerEntity.ServerStatus.ONLINE)
            .findFirst();

        if (dockerServer.isPresent()) {
            ServerEntity server = dockerServer.get();
            // Double-check với ping để đảm bảo server thực sự online
            if (serverService.pingServer(server.getId(), 5000)) {
                return server;
            }
        }

        // Nếu không có server DOCKER online, tìm server DOCKER đầu tiên
        dockerServer = serverRepository.findAll().stream()
            .filter(server -> "DOCKER".equals(server.getRole()))
            .findFirst();

        return dockerServer.orElse(null);
    }

    /**
     * Kiểm tra trạng thái Docker trên server
     */
    @Override
    public DockerStatusResponse getDockerStatus() {
        DockerStatusResponse response = new DockerStatusResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setInstalled(false);
            response.setError("Không tìm thấy server Docker nào");
            return response;
        }

        // Kiểm tra xem server có online không
        if (dockerServer.getStatus() != ServerEntity.ServerStatus.ONLINE) {
            response.setInstalled(false);
            response.setDockerHost(dockerServer.getIp());
            response.setError("Server Docker không online");
            return response;
        }

        try {
            // Double-check server connectivity trước khi thực hiện lệnh
            boolean isReachable = serverService.pingServer(dockerServer.getId(), 3000);
            if (!isReachable) {
                response.setInstalled(false);
                response.setDockerHost(dockerServer.getIp());
                response.setError("Server Docker không thể kết nối được");
                return response;
            }

            // Sử dụng ServerService để thực thi lệnh kiểm tra Docker
            String output = serverService.execCommand(dockerServer.getId(), "docker --version", 10000);

            if (output != null && !output.trim().isEmpty()) {
                // Docker đã được cài đặt
                response.setInstalled(true);
                response.setDockerHost(dockerServer.getIp());

                // Parse version từ output
                String version = "Unknown";
                if (output.contains("Docker version")) {
                    version = output.replace("Docker version", "").trim().split(" ")[0];
                    // Loại bỏ dấu phẩy ở cuối nếu có
                    version = version.replaceAll("[,;]$", "").trim();
                    response.setVersion(version);
                } else {
                    response.setVersion(version);
                }
                
                // Kiểm tra username đã đăng nhập Docker Hub
                try {
                    String loggedInUsername = getDockerLoggedInUsername(dockerServer);
                    if (loggedInUsername != null && !loggedInUsername.isEmpty()) {
                        response.setLoggedInUsername(loggedInUsername);
                        logger.info("Docker da dang nhap voi username: {} tren server {}", loggedInUsername, dockerServer.getIp());
                    }
                } catch (Exception e) {
                    logger.debug("Khong the lay thong tin dang nhap Docker: {}", e.getMessage());
                    // Không set loggedInUsername nếu có lỗi (có thể chưa đăng nhập)
                }
                
                logger.info("Docker da duoc cai dat tren server {} voi phien ban: {}", dockerServer.getIp(), version);
            } else {
                // Docker chưa được cài đặt
                response.setInstalled(false);
                response.setDockerHost(dockerServer.getIp());
                response.setError("Docker chưa được cài đặt");
                logger.info("Docker chưa được cài đặt trên server {}", dockerServer.getIp());
            }

        } catch (Exception e) {
            logger.error("Lỗi khi kiểm tra trạng thái Docker trên server {}: {}", dockerServer.getIp(), e.getMessage(), e);
            response.setInstalled(false);
            response.setDockerHost(dockerServer.getIp());
            response.setError("Lỗi khi kiểm tra trạng thái Docker: " + e.getMessage());
        }

        return response;
    }

    /**
     * Lấy username đã đăng nhập Docker Hub từ config file
     */
    private String getDockerLoggedInUsername(ServerEntity server) {
        try {
            // Khi dùng sudo docker login, config được lưu ở /root/.docker/config.json
            // Thử đọc từ nhiều vị trí có thể:
            // 1. /root/.docker/config.json (khi dùng sudo)
            // 2. ~/.docker/config.json (user hiện tại)
            // 3. $HOME/.docker/config.json (home của user hiện tại)
            
            String[] configPaths = {
                "/root/.docker/config.json",  // Ưu tiên: khi dùng sudo docker login
                "~/.docker/config.json",       // User home
                "$HOME/.docker/config.json"    // Home của user hiện tại
            };
            
            String configContent = null;
            for (String configPath : configPaths) {
                try {
                    // Thử đọc với sudo trước (vì docker login có thể chạy với sudo)
                    String command = String.format("sudo cat %s 2>/dev/null || cat %s 2>/dev/null || echo '{}'", configPath, configPath);
                    String content = serverService.execCommand(server.getId(), command, 10000);
                    
                    if (content != null && !content.trim().isEmpty() && !content.trim().equals("{}") && !content.contains("No such file")) {
                        // Kiểm tra xem có phải là JSON hợp lệ không
                        if (content.trim().startsWith("{") && (content.contains("auths") || content.contains("username") || content.contains("auth"))) {
                            configContent = content;
                            logger.debug("Tim thay Docker config tai: {}", configPath);
                            break;
                        }
                    }
                } catch (Exception e) {
                    logger.debug("Khong the doc config tu {}: {}", configPath, e.getMessage());
                }
            }
            
            if (configContent == null || configContent.trim().isEmpty() || configContent.trim().equals("{}")) {
                return null;
            }
            
            // Parse JSON để lấy username từ auths
            // Format: {"auths":{"https://index.docker.io/v1/":{"username":"xxx","auth":"base64"}}}
            // Hoặc có thể chỉ có "auth" field (base64 encoded username:password)
            
            // Cách 1: Tìm username field trực tiếp
            if (configContent.contains("\"username\"")) {
                // Extract username từ JSON
                String usernamePattern = "\"username\"\\s*:\\s*\"([^\"]+)\"";
                java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(usernamePattern);
                java.util.regex.Matcher matcher = pattern.matcher(configContent);
                if (matcher.find()) {
                    return matcher.group(1);
                }
            }
            
            // Cách 2: Nếu không có username field, thử decode từ auth field (base64)
            if (configContent.contains("\"auth\"")) {
                String authPattern = "\"auth\"\\s*:\\s*\"([^\"]+)\"";
                java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(authPattern);
                java.util.regex.Matcher matcher = pattern.matcher(configContent);
                if (matcher.find()) {
                    String authBase64 = matcher.group(1);
                    try {
                        // Decode base64
                        byte[] decodedBytes = java.util.Base64.getDecoder().decode(authBase64);
                        String decoded = new String(decodedBytes);
                        // Format: "username:password"
                        if (decoded.contains(":")) {
                            return decoded.split(":")[0];
                        }
                    } catch (Exception e) {
                        logger.debug("Khong the decode auth string: {}", e.getMessage());
                    }
                }
            }
            
            return null;
        } catch (Exception e) {
            logger.debug("Loi khi doc Docker config: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Validate server trước khi thực hiện Docker operations
     */
    private boolean validateDockerServer(ServerEntity server) {
        // Check server status
        if (server.getStatus() != ServerEntity.ServerStatus.ONLINE) {
            logger.warn("Server {} không online (status: {})", server.getIp(), server.getStatus());
            return false;
        }

        // Ping server để đảm bảo connectivity
        boolean isReachable = serverService.pingServer(server.getId(), 5000);
        if (!isReachable) {
            logger.warn("Server {} không thể ping được", server.getIp());
            return false;
        }

        return true;
    }

    /**
     * Thực thi lệnh sudo thông minh:
     * - Nếu có SSH key và sudo NOPASSWD: dùng execCommand với "sudo" (không cần password)
     * - Nếu không: dùng execCommandWithSudo với password
     */
    private String executeSudoCommand(ServerEntity server, String command, String sudoPassword, int timeoutMs) {
        try {
            // Kiểm tra xem server có SSH key và sudo NOPASSWD không
            var authStatus = serverService.checkServerAuthStatus(server.getId());
            
            // Nếu có SSH key và có sudo NOPASSWD, dùng execCommand (không cần password)
            if (authStatus.isHasSshKey() 
                    && authStatus.getHasSudoNopasswd() != null 
                    && authStatus.getHasSudoNopasswd()) {
                // Loại bỏ "sudo -S" và thay bằng "sudo" (không cần password)
                String cleanCommand = command.replace("sudo -S", "sudo").trim();
                logger.debug("Thực thi lệnh với SSH key + sudo NOPASSWD: {}", cleanCommand);
                return serverService.execCommand(server.getId(), cleanCommand, timeoutMs);
            }
            
            // Nếu không có sudo NOPASSWD, dùng execCommandWithSudo với password
            logger.debug("Thực thi lệnh với sudo password: {}", command);
            return serverService.execCommandWithSudo(server.getId(), command, sudoPassword, timeoutMs);
            
        } catch (Exception e) {
            logger.error("Lỗi khi thực thi lệnh '{}' trên server {}: {}", command, server.getIp(), e.getMessage());
            throw new RuntimeException("Lỗi khi thực thi lệnh: " + e.getMessage(), e);
        }
    }

    /**
     * Cài đặt Docker trên server
     */
    @Override
    public AnsibleOperationResponse installDocker(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng để thực hiện cài đặt");
            return response;
        }

        String taskId = UUID.randomUUID().toString();
        response.setTaskId(taskId);
        response.setSuccess(true);
        response.setMessage("Đã bắt đầu cài đặt Docker");

        // Tạo task status để tracking
        DockerTaskStatus taskStatus = new DockerTaskStatus(taskId);
        taskStatus.appendLog("Bat dau cai dat Docker tren server " + dockerServer.getIp() + "\n");
        taskCache.put(taskId, taskStatus);

        // Chạy cài đặt Docker trong background thread
        Thread installThread = new Thread(() -> {
            try {
                logger.info("Bắt đầu cài đặt Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
                executeDockerInstall(dockerServer, request.getSudoPassword(), taskId, taskStatus);
                logger.info("Hoàn thành cài đặt Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
            } catch (Exception e) {
                logger.error("Thread execution failed for Docker install on server {} (taskId: {}): {}", dockerServer.getIp(), taskId, e.getMessage(), e);
                if (taskStatus.getStatus().equals("running")) {
                    taskStatus.markFailed("Loi khi cai dat Docker: " + e.getMessage(), taskStatus.getCurrentStep());
                }
            }
        });
        installThread.setDaemon(true); // Đánh dấu là daemon thread
        installThread.start();

        return response;
    }

    /**
     * Gỡ Docker khỏi server
     */
    @Override
    public AnsibleOperationResponse uninstallDocker(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng để thực hiện gỡ bỏ");
            return response;
        }

        String taskId = UUID.randomUUID().toString();
        response.setTaskId(taskId);
        response.setSuccess(true);
        response.setMessage("Đã bắt đầu gỡ Docker");

        // Tạo task status để tracking
        DockerTaskStatus taskStatus = new DockerTaskStatus(taskId);
        taskStatus.appendLog("Bat dau go Docker tren server " + dockerServer.getIp() + "\n");
        taskCache.put(taskId, taskStatus);

        // Chạy gỡ Docker trong background thread
        Thread uninstallThread = new Thread(() -> {
            try {
                logger.info("Bắt đầu gỡ Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
                executeDockerUninstall(dockerServer, request.getSudoPassword(), taskId, taskStatus);
                logger.info("Hoàn thành gỡ Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
            } catch (Exception e) {
                logger.error("Thread execution failed for Docker uninstall on server {} (taskId: {}): {}", dockerServer.getIp(), taskId, e.getMessage(), e);
                if (taskStatus.getStatus().equals("running")) {
                    taskStatus.markFailed("Loi khi go Docker: " + e.getMessage(), taskStatus.getCurrentStep());
                }
            }
        });
        uninstallThread.setDaemon(true); // Đánh dấu là daemon thread
        uninstallThread.start();

        return response;
    }

    /**
     * Cài đặt lại Docker trên server
     */
    @Override
    public AnsibleOperationResponse reinstallDocker(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng để thực hiện cài đặt lại");
            return response;
        }

        String taskId = UUID.randomUUID().toString();
        response.setTaskId(taskId);
        response.setSuccess(true);
        response.setMessage("Đã bắt đầu cài đặt lại Docker");

        // Tạo task status để tracking
        DockerTaskStatus taskStatus = new DockerTaskStatus(taskId);
        taskStatus.appendLog("Bat dau cai dat lai Docker tren server " + dockerServer.getIp() + "\n");
        taskCache.put(taskId, taskStatus);

        // Chạy cài đặt lại Docker trong background thread
        Thread reinstallThread = new Thread(() -> {
            try {
                logger.info("Bắt đầu cài đặt lại Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
                executeDockerReinstall(dockerServer, request.getSudoPassword(), taskId, taskStatus);
                logger.info("Hoàn thành cài đặt lại Docker trên server {} (taskId: {})", dockerServer.getIp(), taskId);
            } catch (Exception e) {
                logger.error("Thread execution failed for Docker reinstall on server {} (taskId: {}): {}", dockerServer.getIp(), taskId, e.getMessage(), e);
                if (taskStatus.getStatus().equals("running")) {
                    taskStatus.markFailed("Loi khi cai dat lai Docker: " + e.getMessage(), taskStatus.getCurrentStep());
                }
            }
        });
        reinstallThread.setDaemon(true); // Đánh dấu là daemon thread
        reinstallThread.start();

        return response;
    }

    /**
     * Thực hiện cài đặt Docker
     * Các bước tương ứng với frontend:
     * 1. Cập nhật packages
     * 2. Thêm Docker GPG key
     * 3. Thêm Docker repository
     * 4. Cài đặt Docker Engine
     * 5. Khởi động Docker service
     */
    private void executeDockerInstall(ServerEntity server, String sudoPassword, String taskId, DockerTaskStatus taskStatus) {
        try {
            logger.info("Bat dau cai dat Docker tren server {} (taskId: {})", server.getIp(), taskId);
            
            // Bước 1: Cập nhật packages
            taskStatus.setCurrentStep(1);
            taskStatus.appendLog("▶️ Buoc 1: Cap nhat packages\n");
            try {
                executeSudoCommand(server, "sudo -S apt-get update", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S apt-get install -y ca-certificates curl gnupg lsb-release unzip", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 1 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 1: " + e.getMessage(), 1);
                throw e;
            }
            
            // Bước 2: Thêm Docker GPG key
            taskStatus.setCurrentStep(2);
            taskStatus.appendLog("▶️ Buoc 2: Them Docker GPG key\n");
            try {
                executeSudoCommand(server, "sudo -S mkdir -p /etc/apt/keyrings", sudoPassword, 30000);
                executeSudoCommand(server, "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo -S gpg --dearmor -o /etc/apt/keyrings/docker.gpg", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 2 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 2: " + e.getMessage(), 2);
                throw e;
            }
            
            // Bước 3: Thêm Docker repository
            taskStatus.setCurrentStep(3);
            taskStatus.appendLog("▶️ Buoc 3: Them Docker repository\n");
            try {
                executeSudoCommand(server, "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\" | sudo -S tee /etc/apt/sources.list.d/docker.list > /dev/null", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 3 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 3: " + e.getMessage(), 3);
                throw e;
            }
            
            // Bước 4: Cài đặt Docker Engine
            taskStatus.setCurrentStep(4);
            taskStatus.appendLog("▶️ Buoc 4: Cai dat Docker Engine\n");
            try {
                executeSudoCommand(server, "sudo -S apt-get update", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin", sudoPassword, 60000);
                taskStatus.appendLog("✅ Buoc 4 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 4: " + e.getMessage(), 4);
                throw e;
            }
            
            // Bước 5: Khởi động Docker service
            taskStatus.setCurrentStep(5);
            taskStatus.appendLog("▶️ Buoc 5: Khoi dong Docker service\n");
            try {
                executeSudoCommand(server, "sudo -S systemctl start docker", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S systemctl enable docker", sudoPassword, 30000);
                
                // Verify Docker installation
                String dockerVersion = executeSudoCommand(server, "sudo -S docker --version", sudoPassword, 10000);
                String version = "Unknown";
                if (dockerVersion != null && dockerVersion.contains("Docker version")) {
                    version = dockerVersion.replace("Docker version", "").trim().split(" ")[0];
                    // Loại bỏ dấu phẩy ở cuối nếu có
                    version = version.replaceAll("[,;]$", "").trim();
                }
                
                // Bước ẩn: Thêm user vào nhóm docker để không cần sudo
                try {
                    // Lấy username hiện tại
                    String currentUser = serverService.execCommand(server.getId(), "whoami", 5000);
                    if (currentUser != null && !currentUser.trim().isEmpty()) {
                        String username = currentUser.trim();
                        // Thêm user vào docker group
                        executeSudoCommand(server, "sudo -S usermod -aG docker " + username, sudoPassword, 10000);
                        logger.info("Da them user {} vao nhom docker tren server {}", username, server.getIp());
                        
                        // Kiểm tra xem user đã có docker group chưa
                        String groupsOutput = serverService.execCommand(server.getId(), "groups", 5000);
                        if (groupsOutput != null && groupsOutput.contains("docker")) {
                            logger.info("Xac nhan: User {} da co docker group. Groups: {}", username, groupsOutput);
                            taskStatus.appendLog("✅ Da them user vao nhom docker\n");
                        } else {
                            logger.warn("Canh bao: User {} chua co docker group trong groups. Can dang xuat/dang nhap lai. Groups: {}", username, groupsOutput);
                            taskStatus.appendLog("⚠️ Da them user vao nhom docker, nhung can dang xuat/dang nhap lai de ap dung\n");
                        }
                    }
                } catch (Exception e) {
                    // Không throw exception nếu không thể thêm vào group (có thể user không tồn tại)
                    // Chỉ log warning
                    logger.warn("Khong the them user vao nhom docker: {}", e.getMessage());
                    taskStatus.appendLog("⚠️ Khong the them user vao nhom docker: " + e.getMessage() + "\n");
                }
                
                taskStatus.appendLog("✅ Buoc 5 hoan thanh\n");
                taskStatus.markCompleted("Cai dat Docker thanh cong! Phien ban: " + version);
                
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 5: " + e.getMessage(), 5);
                throw e;
            }

        } catch (Exception e) {
            logger.error("Loi khi cai dat Docker tren server {} (taskId: {}): {}", server.getIp(), taskId, e.getMessage(), e);
            if (taskStatus.getStatus().equals("running")) {
                taskStatus.markFailed("Loi khi cai dat Docker: " + e.getMessage(), taskStatus.getCurrentStep());
            }
            throw new RuntimeException("Loi khi cai dat Docker: " + e.getMessage(), e);
        }
    }

    /**
     * Thực hiện gỡ Docker
     * Các bước tương ứng với frontend:
     * 1. Dừng Docker service
     * 2. Gỡ Docker packages
     * 3. Xóa Docker data
     * 4. Dọn dẹp cấu hình
     */
    private void executeDockerUninstall(ServerEntity server, String sudoPassword, String taskId, DockerTaskStatus taskStatus) {
        try {
            // Bước 1: Dừng Docker service
            taskStatus.setCurrentStep(1);
            taskStatus.appendLog("▶️ Buoc 1: Dung Docker service\n");
            try {
                executeSudoCommand(server, "sudo -S systemctl stop docker", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 1 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 1: " + e.getMessage(), 1);
                throw e;
            }
            
            // Bước 2: Gỡ Docker packages
            taskStatus.setCurrentStep(2);
            taskStatus.appendLog("▶️ Buoc 2: Go Docker packages\n");
            try {
                executeSudoCommand(server, "sudo -S apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S apt-get autoremove -y", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 2 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 2: " + e.getMessage(), 2);
                throw e;
            }
            
            // Bước 3: Xóa Docker data
            taskStatus.setCurrentStep(3);
            taskStatus.appendLog("▶️ Buoc 3: Xoa Docker data\n");
            try {
                executeSudoCommand(server, "sudo -S rm -rf /var/lib/docker", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S rm -rf /etc/docker", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 3 hoan thanh\n");
                Thread.sleep(1000);
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 3: " + e.getMessage(), 3);
                throw e;
            }
            
            // Bước 4: Dọn dẹp cấu hình
            taskStatus.setCurrentStep(4);
            taskStatus.appendLog("▶️ Buoc 4: Don dep cau hinh\n");
            try {
                executeSudoCommand(server, "sudo -S rm /etc/apt/sources.list.d/docker.list", sudoPassword, 30000);
                executeSudoCommand(server, "sudo -S rm /etc/apt/keyrings/docker.gpg", sudoPassword, 30000);
                taskStatus.appendLog("✅ Buoc 4 hoan thanh\n");
                taskStatus.markCompleted("Go Docker thanh cong!");
            } catch (Exception e) {
                taskStatus.markFailed("Loi o buoc 4: " + e.getMessage(), 4);
                throw e;
            }

        } catch (Exception e) {
            logger.error("Loi khi go Docker tren server {} (taskId: {}): {}", server.getIp(), taskId, e.getMessage(), e);
            if (taskStatus.getStatus().equals("running")) {
                taskStatus.markFailed("Loi khi go Docker: " + e.getMessage(), taskStatus.getCurrentStep());
            }
            throw new RuntimeException("Loi khi go Docker: " + e.getMessage(), e);
        }
    }

    /**
     * Thực hiện cài đặt lại Docker
     */
    private void executeDockerReinstall(ServerEntity server, String sudoPassword, String taskId, DockerTaskStatus taskStatus) {
        try {
            taskStatus.appendLog("Bat dau go Docker...\n");
            // Gỡ Docker trước
            executeDockerUninstall(server, sudoPassword, taskId, taskStatus);
            
            taskStatus.appendLog("Cho 3 giay de dam bao go bo hoan tat...\n");
            try {
                Thread.sleep(3000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Task bi ngat ket noi", e);
            }
            
            taskStatus.appendLog("Bat dau cai dat lai Docker...\n");
            taskStatus.setCurrentStep(0);
            // Cài đặt lại Docker
            executeDockerInstall(server, sudoPassword, taskId, taskStatus);
        } catch (Exception e) {
            logger.error("Loi khi cai dat lai Docker tren server {} (taskId: {}): {}", server.getIp(), taskId, e.getMessage(), e);
            if (taskStatus.getStatus().equals("running")) {
                taskStatus.markFailed("Loi khi cai dat lai Docker: " + e.getMessage(), taskStatus.getCurrentStep());
            }
            throw e;
        }
    }

    /**
     * Lấy trạng thái task Docker
     */
    public AnsibleTaskStatusResponse getDockerTaskStatus(String taskId) {
        AnsibleTaskStatusResponse response = new AnsibleTaskStatusResponse();
        response.setTaskId(taskId);
        
        DockerTaskStatus taskStatus = taskCache.get(taskId);
        if (taskStatus == null) {
            response.setSuccess(false);
            response.setStatus("not_found");
            response.setLogs("");
            response.setProgress(0);
            response.setError("Khong tim thay task hoac task da het han");
            return response;
        }
        
        response.setSuccess(true);
        response.setStatus(taskStatus.getStatus());
        // Tính progress dựa trên currentStep (1-5 cho install, 1-4 cho uninstall)
        int maxSteps = 5; // Mặc định cho install
        if (taskStatus.getCurrentStep() > 4) {
            maxSteps = 5; // Install
        } else if (taskStatus.getCurrentStep() > 0 && taskStatus.getCurrentStep() <= 4) {
            maxSteps = 4; // Uninstall
        }
        int progress = taskStatus.getStatus().equals("completed") ? 100 : 
                      (taskStatus.getCurrentStep() * 100 / maxSteps);
        response.setProgress(progress);
        response.setLogs(taskStatus.snapshotLogs());
        response.setStartTime(taskStatus.getStartTime());
        response.setEndTime(taskStatus.getEndTime());
        response.setError(taskStatus.getError());
        
        return response;
    }

    /**
     * Test Docker container bằng hello-world
     */
    @Override
    public AnsibleOperationResponse testDockerContainer(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng");
            return response;
        }

        try {
            // Thực thi lệnh test container
            String command = "sudo docker run hello-world";
            String output = executeSudoCommand(dockerServer, command, request.getSudoPassword(), 60000);
            
            response.setSuccess(true);
            response.setMessage("Test container thành công");
            response.setOutput(output != null ? output : "");
            logger.info("Test Docker container thành công trên server {}", dockerServer.getIp());
        } catch (Exception e) {
            logger.error("Lỗi khi test Docker container trên server {}: {}", dockerServer.getIp(), e.getMessage(), e);
            response.setSuccess(false);
            response.setMessage("Lỗi khi test container: " + e.getMessage());
            response.setOutput(e.getMessage());
        }

        return response;
    }

    /**
     * Đăng nhập Docker Hub
     */
    @Override
    public AnsibleOperationResponse loginDocker(DockerLoginRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng");
            return response;
        }

        if (request.getUsername() == null || request.getUsername().trim().isEmpty()) {
            response.setSuccess(false);
            response.setMessage("Username không được để trống");
            return response;
        }

        if (request.getPassword() == null || request.getPassword().trim().isEmpty()) {
            response.setSuccess(false);
            response.setMessage("Password không được để trống");
            return response;
        }

        try {
            // Thực thi lệnh đăng nhập Docker Hub
            // Sử dụng echo để pipe password vào docker login
            // Redirect stderr vào stdout để có thể kiểm tra lỗi
            String command = String.format("echo '%s' | sudo docker login -u '%s' --password-stdin 2>&1", 
                request.getPassword().replace("'", "'\"'\"'"), 
                request.getUsername().replace("'", "'\"'\"'"));
            String output = executeSudoCommand(dockerServer, command, request.getSudoPassword(), 30000);
            
            // Kiểm tra output để phát hiện lỗi đăng nhập
            if (output != null) {
                String lowerOutput = output.toLowerCase();
                // Kiểm tra các thông báo lỗi phổ biến
                if (lowerOutput.contains("error") || 
                    lowerOutput.contains("unauthorized") || 
                    lowerOutput.contains("incorrect username or password") ||
                    lowerOutput.contains("authentication failed") ||
                    lowerOutput.contains("login failed")) {
                    // Tìm thông báo lỗi cụ thể
                    String errorMessage = "Đăng nhập thất bại";
                    if (output.contains("unauthorized")) {
                        errorMessage = "Sai username hoặc password";
                    } else if (output.contains("incorrect username or password")) {
                        errorMessage = "Sai username hoặc password";
                    } else if (output.contains("authentication failed")) {
                        errorMessage = "Xác thực thất bại";
                    }
                    
                    logger.error("Dang nhap Docker Hub that bai tren server {} voi user {}: {}", 
                        dockerServer.getIp(), request.getUsername(), output);
                    response.setSuccess(false);
                    response.setMessage(errorMessage);
                    response.setOutput(output);
                    return response;
                }
            }
            
            // Kiểm tra output có chứa "Login Succeeded" không
            if (output != null && output.contains("Login Succeeded")) {
                // Đợi một chút để đảm bảo file config đã được ghi
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                
                // Kiểm tra lại bằng cách đọc file config để xác nhận đã đăng nhập thành công
                String loggedInUsername = getDockerLoggedInUsername(dockerServer);
                if (loggedInUsername == null || !loggedInUsername.equals(request.getUsername())) {
                    // Nếu output có "Login Succeeded" nhưng không đọc được config, vẫn coi là thành công
                    // vì có thể file config ở vị trí khác hoặc chưa kịp ghi
                    logger.warn("Dang nhap thanh cong nhung khong doc duoc config file. Output: {}", output);
                    // Vẫn trả về thành công vì output đã có "Login Succeeded"
                } else {
                    logger.info("Xac nhan dang nhap thanh cong: user {} da co trong config", loggedInUsername);
                }
            } else {
                // Nếu không có "Login Succeeded" trong output, coi là thất bại
                logger.warn("Khong tim thay 'Login Succeeded' trong output. Output: {}", output);
                response.setSuccess(false);
                response.setMessage("Đăng nhập thất bại. Vui lòng kiểm tra lại username và password.");
                response.setOutput(output != null ? output : "");
                return response;
            }
            
            response.setSuccess(true);
            response.setMessage("Đăng nhập Docker Hub thành công");
            response.setOutput(output != null ? output : "");
            logger.info("Đăng nhập Docker Hub thành công trên server {} với user {}", dockerServer.getIp(), request.getUsername());
        } catch (Exception e) {
            logger.error("Lỗi khi đăng nhập Docker Hub trên server {}: {}", dockerServer.getIp(), e.getMessage(), e);
            response.setSuccess(false);
            response.setMessage("Lỗi khi đăng nhập: " + e.getMessage());
            response.setOutput(e.getMessage());
        }

        return response;
    }

    /**
     * Kiểm tra Docker containers đang chạy (docker ps)
     */
    @Override
    public AnsibleOperationResponse checkDockerPs(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng");
            return response;
        }

        try {
            // Thực thi lệnh docker ps
            // Thử chạy không cần sudo trước (nếu user đã có quyền)
            String command = "docker ps 2>&1 || sudo docker ps 2>&1";
            String output = executeSudoCommand(dockerServer, command, request.getSudoPassword(), 30000);
            
            response.setSuccess(true);
            response.setMessage("Kiểm tra Docker containers thành công");
            response.setOutput(output != null ? output : "");
            logger.info("Kiem tra Docker ps thanh cong tren server {}", dockerServer.getIp());
        } catch (Exception e) {
            logger.error("Lỗi khi kiểm tra Docker ps trên server {}: {}", dockerServer.getIp(), e.getMessage(), e);
            response.setSuccess(false);
            response.setMessage("Lỗi khi kiểm tra containers: " + e.getMessage());
            response.setOutput(e.getMessage());
        }

        return response;
    }

    /**
     * Liệt kê Docker images (docker images)
     */
    @Override
    public AnsibleOperationResponse listDockerImages(InstallDockerRequest request) {
        AnsibleOperationResponse response = new AnsibleOperationResponse();
        ServerEntity dockerServer = findDockerServer();

        if (dockerServer == null) {
            response.setSuccess(false);
            response.setMessage("Không tìm thấy server Docker nào");
            return response;
        }

        // Validate server trước khi thực hiện
        if (!validateDockerServer(dockerServer)) {
            response.setSuccess(false);
            response.setMessage("Server Docker không sẵn sàng");
            return response;
        }

        try {
            // Thực thi lệnh docker images
            // Thử chạy không cần sudo trước (nếu user đã có quyền)
            String command = "docker images 2>&1 || sudo docker images 2>&1";
            String output = executeSudoCommand(dockerServer, command, request.getSudoPassword(), 30000);
            
            response.setSuccess(true);
            response.setMessage("Liệt kê Docker images thành công");
            response.setOutput(output != null ? output : "");
            logger.info("Liet ke Docker images thanh cong tren server {}", dockerServer.getIp());
        } catch (Exception e) {
            logger.error("Lỗi khi liệt kê Docker images trên server {}: {}", dockerServer.getIp(), e.getMessage(), e);
            response.setSuccess(false);
            response.setMessage("Lỗi khi liệt kê images: " + e.getMessage());
            response.setOutput(e.getMessage());
        }

        return response;
    }

}
